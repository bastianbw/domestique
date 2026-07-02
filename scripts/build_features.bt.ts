// ── Build a PCS-derived `features` import block from the corpus ───────────────
// Turns the scraped ProCyclingStats history (data/historical/*.json, fetched via
// the `procyclingstats` library) into a single importable block carrying each
// rider's learned archetype, season rank, form snapshot, breakaway tendency and
// TERRAIN AFFINITY — the data layer that lifts the live app to the backtested
// accuracy. Paste the output (or load the file) into Stages & Data → ① Import.
//
// Run: npx vitest run --config vitest.backtest.config.ts scripts/build_features.bt.ts
// Output: data/rider_features.json  (a { type:"features", riders:[...] } block)

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  classifyArchetype, baselinePcsRank, computeForm, breakawayTendency, computeTerrainAffinity, strengthFromRank,
} from '../engine/features';
import { dataAvailable, corpusYears, loadCorpus, HIST } from './harness';
import type { FeaturesBlock } from '../engine/types';

const have = dataAvailable();
const AS_OF = process.env.AS_OF ?? '2026-07-01'; // ~Tour 2026 start
const MIN_RESULTS = 6; // need some history to trust the features

describe.skipIf(!have)('build PCS features block', () => {
  it('writes data/rider_features.json from the corpus', () => {
    const years = corpusYears();
    const c = loadCorpus(years);
    const asOfYear = Number(AS_OF.slice(0, 4));

    // Candidate pool: every rider who appears in the most recent season's results
    // (≈ the current-form peloton, the likely start list).
    const latest = Math.max(...years);
    const pool = new Map<string, { name: string; team: string }>(); // url → name+team
    for (const s of c.stages) {
      if (s.year !== latest) continue;
      for (const row of s.results) {
        if (row.riderUrl && row.rider) pool.set(row.riderUrl, { name: row.rider, team: row.team ?? 'UNK' });
      }
    }

    const round2 = (o: Record<string, number>) =>
      Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v * 1000) / 1000]));

    // First pass: per-rider features (rank/form/archetype/affinity).
    type Row = FeaturesBlock['riders'][number] & { team: string; rank: number };
    const rows: Row[] = [];
    for (const [url, { name, team }] of pool) {
      const tl = (c.timeline.get(url) ?? []).filter((e) => e.date < AS_OF);
      if (tl.length < MIN_RESULTS) continue;
      const prof = c.profile.get(url);
      const archetype = prof ? classifyArchetype(prof.speciality) : undefined;
      const pcsRank = prof ? baselinePcsRank(prof.seasonHistory, asOfYear) : 300;
      const form = Math.round(computeForm(tl, AS_OF));
      const brk = Math.round(breakawayTendency(tl.map((e) => e.breakKm)));
      const terrainAffinity = computeTerrainAffinity(tl.map((e) => ({ type: e.type, rank: e.rank })));
      rows.push({
        rider: name, team, rank: pcsRank,
        ...(archetype ? { archetype } : {}),
        ...(pcsRank ? { pcsRank } : {}),
        form,
        breakawayTendency: brk,
        ...(Object.keys(terrainAffinity).length ? { terrainAffinity: round2(terrainAffinity as Record<string, number>) } : {}),
      });
    }

    // Second pass: team strength = mean rider strength on the team (drives TTT,
    // sprint trains and Holdbonus). Without it every rider shares the default and
    // the TTT stage looks uniform.
    const byTeam = new Map<string, number[]>();
    for (const r of rows) (byTeam.get(r.team) ?? byTeam.set(r.team, []).get(r.team)!).push(strengthFromRank(r.rank));
    const ridersOut: FeaturesBlock['riders'] = rows.map(({ team, rank, ...r }) => {
      const arr = byTeam.get(team)!;
      const teamStrength = Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
      return { ...r, teamStrength };
    });

    const block: FeaturesBlock = { type: 'features', asOf: AS_OF, riders: ridersOut };
    const out = path.join(HIST, '..', 'rider_features.json');
    fs.writeFileSync(out, JSON.stringify(block, null, 1), 'utf-8');

    const withAff = ridersOut.filter((r) => r.terrainAffinity).length;
    // eslint-disable-next-line no-console
    console.log(`\nWrote ${ridersOut.length} riders to data/rider_features.json (as of ${AS_OF}); ${withAff} have terrain affinity.`);
    const sample = ridersOut.find((r) => r.terrainAffinity && /pogac|vingegaard|philipsen/i.test(r.rider));
    if (sample) console.log('  sample:', JSON.stringify(sample));

    expect(ridersOut.length).toBeGreaterThan(50);
  });
});
