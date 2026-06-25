import { describe, it, expect } from 'vitest';
import {
  classifyArchetype,
  computeForm,
  positionQuality,
  baselinePcsRank,
  strengthFromRank,
  breakawayTendency,
} from './features';
import {
  scoreStage,
  aggregateScores,
  reliabilityTop5,
  uniformDist,
  rankOnlyDist,
} from './backtest';

describe('classifyArchetype', () => {
  it('classifies a GC rider from a real specialty vector (Pogačar)', () => {
    expect(
      classifyArchetype({
        one_day_races: 9983, gc: 7844, time_trial: 3407,
        sprint: 360, climber: 10122, hills: 4410,
      }),
    ).toBe('gc');
  });

  it('classifies a pure sprinter', () => {
    expect(
      classifyArchetype({ sprint: 4000, one_day_races: 300, hills: 100, gc: 50 }),
    ).toBe('sprinter');
  });

  it('classifies a pure climber (low GC points)', () => {
    expect(classifyArchetype({ climber: 2000, gc: 300, hills: 200 })).toBe('climber');
  });

  it('classifies a low-points rider as domestique', () => {
    expect(classifyArchetype({ sprint: 20, climber: 30, gc: 10 })).toBe('domestique');
  });
});

describe('form', () => {
  it('positionQuality is 1.0 for a win and decays', () => {
    expect(positionQuality(1)).toBeCloseTo(1, 6);
    expect(positionQuality(10)).toBeLessThan(0.6);
    expect(positionQuality(0)).toBe(0);
  });

  it('rewards a recent win over an old one', () => {
    const recent = computeForm(
      [{ date: '2026-06-10', rank: 1, level: 800 }],
      '2026-06-20',
    );
    const old = computeForm(
      [{ date: '2026-01-10', rank: 1, level: 800 }],
      '2026-06-20',
    );
    expect(recent).toBeGreaterThan(70);
    expect(old).toBe(45); // outside window → fallback
  });

  it('ignores results on/after the as-of date (no lookahead)', () => {
    const f = computeForm(
      [{ date: '2026-06-25', rank: 1, level: 800 }],
      '2026-06-20',
    );
    expect(f).toBe(45);
  });

  it('falls back when no results', () => {
    expect(computeForm([], '2026-06-20')).toBe(45);
  });
});

describe('strength / rank priors', () => {
  it('prefers an established prior when the current season is thin', () => {
    const hist = [
      { season: 2026, points: 50, rank: 400 },
      { season: 2025, points: 2000, rank: 8 },
    ];
    expect(baselinePcsRank(hist, 2026)).toBe(8);
  });

  it('uses the current season when it has enough points', () => {
    const hist = [
      { season: 2026, points: 900, rank: 12 },
      { season: 2025, points: 2000, rank: 8 },
    ];
    expect(baselinePcsRank(hist, 2026)).toBe(12);
  });

  it('maps rank 1 to ~100 strength and decays', () => {
    expect(strengthFromRank(1)).toBeCloseTo(100, 4);
    expect(strengthFromRank(120)).toBeLessThan(50);
  });
});

describe('breakawayTendency', () => {
  it('is 0 for riders never in the break and rises with break-kms', () => {
    expect(breakawayTendency([0, 0, 0])).toBe(0);
    expect(breakawayTendency([40, 60, 20])).toBeGreaterThan(40);
  });
});

describe('scoreStage', () => {
  const N = 5;
  // perfect predictor: each rider's mass on their realised slot
  const actuals = [
    { riderId: 'a', rank: 1 },
    { riderId: 'b', rank: 2 },
    { riderId: 'c', rank: 3 },
  ];

  it('gives near-zero NLL to a perfect predictor and worse to uniform', () => {
    const perfect = new Map<string, number[]>([
      ['a', [1, 0, 0, 0, 0]],
      ['b', [0, 1, 0, 0, 0]],
      ['c', [0, 0, 1, 0, 0]],
    ]);
    const uni = new Map<string, number[]>([
      ['a', uniformDist(N)],
      ['b', uniformDist(N)],
      ['c', uniformDist(N)],
    ]);
    const sp = scoreStage(perfect, actuals);
    const su = scoreStage(uni, actuals);
    expect(sp.nll).toBeLessThan(su.nll);
    expect(sp.nll).toBeCloseTo(0, 5);
    expect(sp.n).toBe(3);
  });

  it('scores Brier for the win event', () => {
    const dist = new Map<string, number[]>([
      ['a', [0.9, 0.1, 0, 0, 0]],
      ['b', [0.1, 0.9, 0, 0, 0]],
    ]);
    const s = scoreStage(dist, [{ riderId: 'a', rank: 1 }, { riderId: 'b', rank: 2 }]);
    // a: (0.9-1)^2=0.01 ; b: (0.1-0)^2=0.01 → mean 0.01
    expect(s.brierWin).toBeCloseTo(0.01, 6);
  });
});

describe('aggregateScores', () => {
  it('count-weights per-stage scores', () => {
    const agg = aggregateScores([
      { nll: 2, brierWin: 0.1, brierTop5: 0.1, brierTop15: 0.1, placementGrowthMAE: 1000, n: 10 },
      { nll: 4, brierWin: 0.2, brierTop5: 0.2, brierTop15: 0.2, placementGrowthMAE: 2000, n: 30 },
    ]);
    expect(agg.nll).toBeCloseTo((2 * 10 + 4 * 30) / 40, 6);
    expect(agg.stages).toBe(2);
    expect(agg.n).toBe(40);
  });
});

describe('reliabilityTop5', () => {
  it('buckets predictions and counts them all', () => {
    const samples = [
      { pTop5: 0.05, actualTop5: false },
      { pTop5: 0.95, actualTop5: true },
      { pTop5: 0.97, actualTop5: true },
    ];
    const table = reliabilityTop5(samples);
    expect(table).toHaveLength(10);
    expect(table.reduce((a, b) => a + b.count, 0)).toBe(3);
    expect(table[9].count).toBe(2); // both high-confidence preds in top bucket
  });
});

describe('rankOnlyDist', () => {
  it('peaks at the rider rank position and is normalised', () => {
    const d = rankOnlyDist(0, 10);
    const sum = d.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
    expect(Math.max(...d)).toBe(d[0]); // best-ranked rider peaks at P1
  });
});
