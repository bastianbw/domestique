// ── Backtest report runner (§2, upgrade) ─────────────────────────────────────
// Loads the scraped 2026 corpus + rider profiles, builds each historical stage's
// roster as-of its date (archetype / form / pcsRank / breakaway from features.ts),
// runs the structural finishing model (buildField, no odds), and scores it vs
// baselines. Prints a metrics table and gates: the model must beat uniform.
//
// Run: npx vitest run --config vitest.backtest.config.ts
// Skips automatically if data/historical/*.json is absent.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import type { Rider, Stage, StageType } from '../engine/types';
import { buildField } from '../engine/probability';
import { simulateStage } from '../engine/simulate';
import {
  classifyArchetype,
  computeForm,
  baselinePcsRank,
  strengthFromRank,
  breakawayTendency,
  type RiderProfile,
  type StageRow2026,
} from '../engine/features';
import {
  scoreStage,
  aggregateScores,
  reliabilityTop5,
  precisionAtK,
  uniformDist,
  rankOnlyDist,
  type ActualFinish,
  type StageScore,
} from '../engine/backtest';

const HIST = path.join(process.cwd(), 'data', 'historical');
const RESULTS = path.join(HIST, 'results_2026.json');
const RIDERS = path.join(HIST, 'riders.json');
const haveData = fs.existsSync(RESULTS) && fs.existsSync(RIDERS);
const N = 176; // model field size; baselines use the same slot count

const SEASON = 2026;
const MIN_FINISHERS = 30;

interface TimelineEntry { date: string; rank: number; level: number; breakKm: number }

function loadCorpus() {
  const results = JSON.parse(fs.readFileSync(RESULTS, 'utf-8')) as { stages: StageRow2026[] };
  const ridersRaw = JSON.parse(fs.readFileSync(RIDERS, 'utf-8')) as { riders: RiderProfile[] };
  const profile = new Map<string, RiderProfile>();
  for (const r of ridersRaw.riders) profile.set(r.url, r);

  // Per-rider timeline (all classified finishes), for as-of form & breakaway.
  const timeline = new Map<string, TimelineEntry[]>();
  for (const s of results.stages) {
    if (!s.date) continue;
    const level = s.startlistQuality ?? 0;
    for (const row of s.results) {
      const url = row.riderUrl;
      if (!url || row.rank == null || row.rank < 1) continue;
      const arr = timeline.get(url) ?? [];
      arr.push({ date: s.date, rank: row.rank, level, breakKm: row.breakawayKms ?? 0 });
      timeline.set(url, arr);
    }
  }
  return { stages: results.stages, profile, timeline };
}

function buildRoster(
  s: StageRow2026,
  profile: Map<string, RiderProfile>,
  timeline: Map<string, TimelineEntry[]>,
): { roster: Rider[]; actuals: ActualFinish[] } {
  const asOf = s.date ?? '';
  const roster: Rider[] = [];
  const actuals: ActualFinish[] = [];
  const seen = new Set<string>();

  for (const row of s.results) {
    if (row.rank == null || row.rank < 1) continue; // classified finishers only
    const id = row.riderUrl ?? `noid:${row.rider}:${row.bib ?? ''}`;
    if (seen.has(id)) continue;
    seen.add(id);

    const prof = row.riderUrl ? profile.get(row.riderUrl) : undefined;
    const archetype = prof ? classifyArchetype(prof.speciality) : 'domestique';
    const pcsRank = prof ? baselinePcsRank(prof.seasonHistory, SEASON) : 900;

    const tl = (row.riderUrl ? timeline.get(row.riderUrl) : undefined) ?? [];
    const past = asOf ? tl.filter((e) => e.date < asOf) : [];
    const form = computeForm(past, asOf || '2026-12-31');
    const brk = breakawayTendency(past.map((e) => e.breakKm));

    roster.push({
      id,
      name: row.rider,
      team: row.team ?? 'UNK',
      archetype,
      price: 1,
      form,
      pcsRank,
      teamStrength: 50, // filled below from team aggregate
      injury: 'fit',
      breakawayTendency: brk,
    });
    actuals.push({ riderId: id, rank: row.rank });
  }

  // Team strength = mean rider strength on the team within this field.
  const byTeam = new Map<string, number[]>();
  for (const r of roster) {
    const arr = byTeam.get(r.team) ?? [];
    arr.push(strengthFromRank(r.pcsRank));
    byTeam.set(r.team, arr);
  }
  for (const r of roster) {
    const arr = byTeam.get(r.team)!;
    r.teamStrength = arr.reduce((a, b) => a + b, 0) / arr.length;
  }
  return { roster, actuals };
}

function toStage(s: StageRow2026): Stage {
  return {
    stage: s.stage,
    date: s.date ?? '',
    type: s.ourType as StageType,
    route: s.race,
    km: s.distance ?? 0,
    note: '',
    sprintPtsOnOffer: 0,
    mtnPtsOnOffer: 0,
    profileScore: s.profileScore ?? undefined,
    verticalMeters: s.verticalMeters ?? undefined,
  };
}

function modelDistMap(roster: Rider[], stage: Stage): Map<string, number[]> {
  const dists = buildField(roster, stage);
  return new Map(dists.map((d) => [d.riderId, d.probs]));
}

function simDistMap(roster: Rider[], stage: Stage): Map<string, number[]> {
  const dists = simulateStage(roster, stage, undefined, { nSims: 2000, seed: 0x5eed });
  return new Map(dists.map((d) => [d.riderId, d.probs]));
}

function uniformMap(roster: Rider[]): Map<string, number[]> {
  const u = uniformDist(N);
  return new Map(roster.map((r) => [r.id, u]));
}

function rankOnlyMap(roster: Rider[]): Map<string, number[]> {
  const order = [...roster].sort((a, b) => a.pcsRank - b.pcsRank);
  const m = new Map<string, number[]>();
  order.forEach((r, i) => m.set(r.id, rankOnlyDist(i, N)));
  return m;
}

/** Field ids ordered best→worst by P(top-`k`); ties broken by id (no order leak). */
function rankedByHead(distMap: Map<string, number[]>, k: number): string[] {
  return [...distMap.entries()]
    .map(([id, probs]) => [id, probs.slice(0, k).reduce((a, b) => a + b, 0)] as const)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([id]) => id);
}

interface Prec { p5: number; p15: number; n: number }
function accPrec(distMap: Map<string, number[]>, top5: Set<string>, top15: Set<string>): Prec {
  return {
    p5: precisionAtK(rankedByHead(distMap, 5), top5, 5),
    p15: precisionAtK(rankedByHead(distMap, 15), top15, 15),
    n: 1,
  };
}
/** Analytic precision@k of a random pick from a field of `size` (all top-k present). */
function randomPrec(size: number): Prec {
  return { p5: size ? 5 / size : 0, p15: size ? 15 / size : 0, n: 1 };
}
function meanPrec(ps: Prec[]): { p5: number; p15: number } {
  if (!ps.length) return { p5: 0, p15: 0 };
  return {
    p5: ps.reduce((a, b) => a + b.p5, 0) / ps.length,
    p15: ps.reduce((a, b) => a + b.p15, 0) / ps.length,
  };
}

function fmt(s: StageScore & { stages?: number }, label: string): string {
  return [
    label.padEnd(12),
    `NLL ${s.nll.toFixed(3)}`,
    `BrierWin ${s.brierWin.toFixed(4)}`,
    `Top5 ${s.brierTop5.toFixed(4)}`,
    `Top15 ${s.brierTop15.toFixed(4)}`,
    `MAE ${Math.round(s.placementGrowthMAE).toLocaleString()}`,
    `n=${s.n}`,
  ].join('  ');
}

describe.skipIf(!haveData)('2026 structural backtest', () => {
  it('structural model discriminates top-k better than a random field', () => {
    const { stages, profile, timeline } = loadCorpus();

    const modelScores: StageScore[] = [];
    const uniScores: StageScore[] = [];
    const rankScores: StageScore[] = [];
    const simScores: StageScore[] = [];
    const modelPrec: Prec[] = [];
    const uniPrec: Prec[] = [];
    const rankPrec: Prec[] = [];
    const simPrec: Prec[] = [];
    const breakStagePrec: Prec[] = [];
    const bunchStagePrec: Prec[] = [];
    const simBreakPrec: Prec[] = [];
    const simBunchPrec: Prec[] = [];
    const byType = new Map<string, StageScore[]>();
    const reliability: Array<{ pTop5: number; actualTop5: boolean }> = [];
    let usedStages = 0;
    let skipped = 0;

    for (const s of stages) {
      if (s.ourType === 'ttt') { skipped++; continue; }
      const finishers = s.results.filter((r) => r.rank != null && r.rank >= 1).length;
      if (finishers < MIN_FINISHERS) { skipped++; continue; }

      const { roster, actuals } = buildRoster(s, profile, timeline);
      if (roster.length < MIN_FINISHERS) { skipped++; continue; }
      const stage = toStage(s);

      const model = modelDistMap(roster, stage);
      const uni = uniformMap(roster);
      const rk = rankOnlyMap(roster);
      const mScore = scoreStage(model, actuals);
      modelScores.push(mScore);
      uniScores.push(scoreStage(uni, actuals));
      rankScores.push(scoreStage(rk, actuals));

      const rankById = new Map(actuals.map((a) => [a.riderId, a.rank ?? 999]));
      const top5 = new Set(actuals.filter((a) => (a.rank ?? 999) <= 5).map((a) => a.riderId));
      const top15 = new Set(actuals.filter((a) => (a.rank ?? 999) <= 15).map((a) => a.riderId));
      const mPrec = accPrec(model, top5, top15);
      modelPrec.push(mPrec);
      uniPrec.push(randomPrec(roster.length));
      rankPrec.push(accPrec(rk, top5, top15));

      const simMap = simDistMap(roster, stage);
      simScores.push(scoreStage(simMap, actuals));
      const sPrec = accPrec(simMap, top5, top15);
      simPrec.push(sPrec);

      // Was this stage won from a break? (winner spent km up the road.)
      const winner = s.results.find((r) => r.rank === 1);
      const breakWon = (winner?.breakawayKms ?? 0) > 0;
      (breakWon ? breakStagePrec : bunchStagePrec).push(mPrec);
      (breakWon ? simBreakPrec : simBunchPrec).push(sPrec);

      const tarr = byType.get(s.ourType) ?? [];
      tarr.push(mScore);
      byType.set(s.ourType, tarr);

      for (const [id, probs] of model) {
        const p5 = probs.slice(0, 5).reduce((a, b) => a + b, 0);
        reliability.push({ pTop5: p5, actualTop5: (rankById.get(id) ?? 999) <= 5 });
      }
      usedStages++;
    }

    const model = aggregateScores(modelScores);
    const uni = aggregateScores(uniScores);
    const rank = aggregateScores(rankScores);
    const mP = meanPrec(modelPrec);
    const uP = meanPrec(uniPrec);
    const rP = meanPrec(rankPrec);

    const lines: string[] = [];
    lines.push('');
    lines.push(`=== 2026 structural backtest — ${usedStages} stages used, ${skipped} skipped ===`);
    const simAgg = aggregateScores(simScores);
    lines.push(fmt(model, 'MODEL'));
    lines.push(fmt(simAgg, 'MODEL-sim'));
    lines.push(fmt(rank, 'rank-only'));
    lines.push(fmt(uni, 'uniform'));
    lines.push('');
    const sP = meanPrec(simPrec);
    lines.push('--- precision@k (fraction of model top-k that actually finish top-k) ---');
    lines.push(`  MODEL      P@5 ${mP.p5.toFixed(3)}  P@15 ${mP.p15.toFixed(3)}`);
    lines.push(`  MODEL-sim  P@5 ${sP.p5.toFixed(3)}  P@15 ${sP.p15.toFixed(3)}`);
    lines.push(`  rank-only  P@5 ${rP.p5.toFixed(3)}  P@15 ${rP.p15.toFixed(3)}`);
    lines.push(`  uniform    P@5 ${uP.p5.toFixed(3)}  P@15 ${uP.p15.toFixed(3)}  (≈ random)`);
    const bkP = meanPrec(breakStagePrec);
    const bnP = meanPrec(bunchStagePrec);
    const sbkP = meanPrec(simBreakPrec);
    const sbnP = meanPrec(simBunchPrec);
    lines.push(`  break-won stages (n=${breakStagePrec.length}):  MODEL P@5 ${bkP.p5.toFixed(3)}  |  MODEL-sim P@5 ${sbkP.p5.toFixed(3)}`);
    lines.push(`  bunch-won stages (n=${bunchStagePrec.length}):  MODEL P@5 ${bnP.p5.toFixed(3)}  |  MODEL-sim P@5 ${sbnP.p5.toFixed(3)}`);
    lines.push('');
    lines.push('--- model NLL by stage type ---');
    for (const [t, arr] of [...byType.entries()].sort()) {
      const a = aggregateScores(arr);
      lines.push(`  ${t.padEnd(10)} NLL ${a.nll.toFixed(3)}  Top5 ${a.brierTop5.toFixed(4)}  stages=${a.stages}  n=${a.n}`);
    }
    lines.push('');
    lines.push('--- reliability: predicted pTop5 vs empirical (model) ---');
    for (const b of reliabilityTop5(reliability)) {
      if (b.count === 0) continue;
      lines.push(`  [${b.lo.toFixed(1)}-${b.hi.toFixed(1)}) pred ${b.predictedMean.toFixed(3)}  emp ${b.empiricalRate.toFixed(3)}  n=${b.count}`);
    }
    // eslint-disable-next-line no-console
    console.log(lines.join('\n'));

    // Gate on discrimination, not exact-position NLL (which a flat predictor
    // games). The structural model must pick top-k better than a flat field.
    expect(usedStages).toBeGreaterThan(20);
    expect(mP.p5).toBeGreaterThan(uP.p5);
    expect(mP.p15).toBeGreaterThan(uP.p15);
  });
});
