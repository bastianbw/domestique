// ── Parameter fitting + held-out validation (steps A & 7) ────────────────────
// "Learn from data": estimate the suitability matrix from the TRAIN years
// (2024+2025) and validate on HELD-OUT 2026, alongside the new features
// (terrain-specific form, field-strength scaling, analytic+sim ensemble). This
// is both the data-driven fit and the capstone out-of-sample test — no leakage,
// since parameters are estimated only on train and scored only on test.
//
// Run: npx vitest run --config vitest.backtest.config.ts scripts/fit.bt.ts

import { describe, it, expect } from 'vitest';
import { defaultConfig, type EngineConfig, type SuitabilityMatrix } from '../engine/config';
import { buildField, calibrateDistribution } from '../engine/probability';
import { buildEnsembleField } from '../engine/simulate';
import { precisionAtK, scoreStage, aggregateScores, type StageScore } from '../engine/backtest';
import {
  HIST, dataAvailable, corpusYears, loadCorpus, buildRoster, toStage, usableStage,
  estimateSuitability, type Corpus,
} from './harness';
import type { StageRow2026 } from '../engine/features';

const have = dataAvailable();

function rankedByHead(map: Map<string, number[]>, k: number): string[] {
  return [...map.entries()]
    .map(([id, p]) => [id, p.slice(0, k).reduce((a, b) => a + b, 0)] as const)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([id]) => id);
}

interface Eval { p5: number; p15: number; brier15: number; stages: number }

function evalConfig(
  testStages: (StageRow2026 & { year: number })[],
  c: Corpus,
  cfg: EngineConfig,
  opts: { terrainForm?: boolean; terrainAffinity?: boolean; ensemble?: boolean; gamma?: number },
): Eval {
  let p5 = 0, p15 = 0, n = 0;
  const scores: StageScore[] = [];
  const gamma = opts.gamma ?? 1;
  for (const s of testStages) {
    if (!usableStage(s)) continue;
    const { roster, actuals } = buildRoster(s, c, { terrainForm: opts.terrainForm, terrainAffinity: opts.terrainAffinity });
    if (roster.length < 30) continue;
    const stage = toStage(s);
    const raw = opts.ensemble ? buildEnsembleField(roster, stage, cfg) : buildField(roster, stage, cfg);
    const dists = raw.map((d) => calibrateDistribution(d, gamma));
    const map = new Map(dists.map((d) => [d.riderId, d.probs]));
    const top5 = new Set(actuals.filter((a) => (a.rank ?? 999) <= 5).map((a) => a.riderId));
    const top15 = new Set(actuals.filter((a) => (a.rank ?? 999) <= 15).map((a) => a.riderId));
    p5 += precisionAtK(rankedByHead(map, 5), top5, 5);
    p15 += precisionAtK(rankedByHead(map, 15), top15, 15);
    scores.push(scoreStage(map, actuals));
    n++;
  }
  const agg = aggregateScores(scores);
  return { p5: p5 / n, p15: p15 / n, brier15: agg.brierTop15, stages: n };
}

function withSuitability(base: EngineConfig, suit: SuitabilityMatrix): EngineConfig {
  return { ...base, suitability: JSON.parse(JSON.stringify(suit)) };
}

/**
 * Fit the analytic/sim ensemble weight PER stage type on the train years by
 * grid-search minimising top-15 Brier, so the more accurate component weighs
 * more on each terrain. Returns an analytic-weight map (sim weight = 1 − w).
 */
function fitEnsembleWeights(
  trainStages: (StageRow2026 & { year: number })[],
  c: Corpus,
  cfg: EngineConfig,
): Record<string, number> {
  const types = ['flat', 'hilly', 'summit', 'high_mtn', 'hilly_itt'] as const;
  const grid = [0, 0.15, 0.3, 0.4, 0.5, 0.6, 0.7, 0.85, 1];
  const byType: Record<string, (StageRow2026 & { year: number })[]> = {};
  for (const s of trainStages) {
    if (!usableStage(s)) continue;
    (byType[s.ourType] ??= []).push(s);
  }
  const out: Record<string, number> = {};
  for (const t of types) {
    const stages = byType[t] ?? [];
    if (stages.length < 4) { out[t] = 0.5; continue; } // too few → neutral
    let bestW = 0.5; let bestBrier = Infinity;
    for (const w of grid) {
      const scores: StageScore[] = [];
      for (const s of stages) {
        const { roster, actuals } = buildRoster(s, c, { terrainForm: true, terrainAffinity: true });
        if (roster.length < 30) continue;
        const dists = buildEnsembleField(roster, toStage(s), cfg, w)
          .map((d) => calibrateDistribution(d, cfg.calibrationGamma));
        scores.push(scoreStage(new Map(dists.map((d) => [d.riderId, d.probs])), actuals));
      }
      const b = aggregateScores(scores).brierTop15;
      if (b < bestBrier) { bestBrier = b; bestW = w; }
    }
    out[t] = bestW;
  }
  return out;
}

describe.skipIf(!have)('learn-from-data fit + held-out 2026 validation', () => {
  it('estimates suitability on 2024+2025 and validates feature stack on 2026', () => {
    const years = corpusYears();
    const testYear = Math.max(...years);
    const trainYears = new Set(years.filter((y) => y < testYear));
    if (trainYears.size === 0) {
      // only one season present → skip gracefully
      expect(years.length).toBeGreaterThan(0);
      return;
    }
    const c = loadCorpus(years);
    const test = c.stages.filter((s) => s.year === testYear);

    const base = defaultConfig();
    const learnedSuit = estimateSuitability(c, trainYears, base.suitability, 1);
    const blendSuit = estimateSuitability(c, trainYears, base.suitability, 0.5);
    const learned = withSuitability(base, learnedSuit);
    const blend = withSuitability(base, blendSuit);

    const g = base.calibrationGamma;
    // Learn the per-stage-type ensemble weights on the TRAIN years only.
    const trainStages = c.stages.filter((s) => trainYears.has(s.year));
    const fittedW = fitEnsembleWeights(trainStages, c, blend);
    const blendFitted: EngineConfig = {
      ...blend,
      ensembleAnalyticWeight: { ...blend.ensembleAnalyticWeight, ...fittedW },
    };

    const rows: Array<[string, Eval]> = [
      ['hand-tuned (baseline)', evalConfig(test, c, base, {})],
      ['learned blend β=0.5', evalConfig(test, c, blend, {})],
      ['+ terrain form+affinity', evalConfig(test, c, blend, { terrainForm: true, terrainAffinity: true })],
      ['+ ensemble (shipped wts)', evalConfig(test, c, blend, { terrainForm: true, terrainAffinity: true, ensemble: true })],
      [`+ calibration γ=${g} (SHIPPING)`, evalConfig(test, c, blend, { terrainForm: true, terrainAffinity: true, ensemble: true, gamma: g })],
      ['(info) grid-refit ens. wts', evalConfig(test, c, blendFitted, { terrainForm: true, terrainAffinity: true, ensemble: true, gamma: g })],
    ];

    const lines: string[] = [];
    lines.push('');
    lines.push(`=== held-out validation: train ${[...trainYears].join('+')} → test ${testYear} (${rows[0][1].stages} stages) ===`);
    for (const [label, e] of rows) {
      lines.push(`  ${label.padEnd(24)}  P@5 ${e.p5.toFixed(3)}  P@15 ${e.p15.toFixed(3)}  Top15Brier ${e.brier15.toFixed(4)}`);
    }
    lines.push('');
    lines.push(`--- fitted ensemble analytic-weights (sim = 1−w): ${JSON.stringify(fittedW)} ---`);
    lines.push('');
    lines.push('--- learned suitability matrix (per type, normalised) ---');
    for (const t of Object.keys(learnedSuit) as Array<keyof SuitabilityMatrix>) {
      const cells = Object.entries(learnedSuit[t]).map(([a, v]) => `${a.slice(0, 4)} ${v.toFixed(2)}`).join('  ');
      lines.push(`  ${String(t).padEnd(10)} ${cells}`);
    }
    // eslint-disable-next-line no-console
    console.log(lines.join('\n'));

    expect(rows[0][1].stages).toBeGreaterThan(20);
  });
});
