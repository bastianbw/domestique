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
    // Also pull in riders with an established multi-year PROFILE but NO 2026
    // stage rows in THIS corpus (e.g. Olav Kooij: a top-30-ranked sprinter for
    // years, but the ~93 scraped 2026 races happened not to include whatever
    // he raced this season) — real, priced, startlist riders who'd otherwise
    // silently fall back to generic defaults. Gate on a genuinely RECENT
    // competitive rank so this doesn't pull in retired/inactive names.
    for (const [url, prof] of c.profile) {
      if (pool.has(url) || !prof.team2026) continue;
      const rank = baselinePcsRank(prof.seasonHistory, asOfYear);
      if (rank < 400) pool.set(url, { name: prof.name, team: prof.team2026 });
    }

    const round2 = (o: Record<string, number>) =>
      Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v * 1000) / 1000]));

    // First pass: per-rider features (rank/form/archetype/affinity).
    type Row = FeaturesBlock['riders'][number] & { team: string; rank: number };
    const rows: Row[] = [];
    for (const [url, { name, team }] of pool) {
      const tl = (c.timeline.get(url) ?? []).filter((e) => e.date < AS_OF);
      const prof = c.profile.get(url);
      // Thin/no 2026 stage-level timeline is only disqualifying when there's
      // also no established profile to fall back on — a profile-only rider
      // (e.g. Kooij) still gets a real archetype/pcsRank from their specialty
      // + season history below, just neutral form/breakaway/no terrain data.
      if (tl.length < MIN_RESULTS && !prof) continue;
      const archetype = prof ? classifyArchetype(prof.speciality) : undefined;
      const pcsRank = prof ? baselinePcsRank(prof.seasonHistory, asOfYear) : 300;
      // computeForm returns recent finishing quality, which is compressed low for
      // the bunch (domestiques rarely place). Lift it onto the live app's active-pro
      // scale (~45-96, like the seed) so contenders aren't over-dampened.
      // Exclude TTT results from the general form snapshot: a TTT "rank" is the
      // whole TEAM's finishing position, not this rider's own — crediting it at
      // full weight (no target stage type to discount it against here) can make a
      // rider whose only good result all season was a strong team time trial read
      // as having decent individual form.
      const individualTl = tl.filter((e) => e.type !== 'ttt');
      const form = Math.max(40, Math.min(96, Math.round(45 + 0.55 * computeForm(individualTl, AS_OF))));
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

    // Second pass: team strength (drives TTT, sprint trains, Holdbonus). A team's
    // strength is set by its LEADERS, not the mean including domestiques (which
    // collapses every team to ~20-40 and makes the TTT score ~0 for everyone). Use
    // the mean of each team's top-3 riders, then rescale ACROSS teams to a realistic
    // ~50-92 spread so elite teams reach the payout tiers the model expects.
    const byTeam = new Map<string, number[]>();
    for (const r of rows) (byTeam.get(r.team) ?? byTeam.set(r.team, []).get(r.team)!).push(strengthFromRank(r.rank));
    const teamTop3 = new Map<string, number>();
    for (const [team, arr] of byTeam) {
      const top = [...arr].sort((a, b) => b - a).slice(0, 3);
      teamTop3.set(team, top.reduce((a, b) => a + b, 0) / top.length);
    }
    const vals = [...teamTop3.values()];
    const lo = Math.min(...vals); const hi = Math.max(...vals);
    const scale = (t: number) => hi > lo ? 50 + 42 * (t - lo) / (hi - lo) : 70;
    const ridersOut: FeaturesBlock['riders'] = rows.map(({ team, rank, ...r }) => ({
      ...r, teamStrength: Math.round(scale(teamTop3.get(team)!)),
    }));

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
