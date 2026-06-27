import { describe, it, expect } from 'vitest';
import {
  classifyArchetype,
  computeForm,
  computeTerrainAffinity,
  positionQuality,
  baselinePcsRank,
  strengthFromRank,
  breakawayTendency,
  terrainSimilarity,
} from './features';
import {
  scoreStage,
  aggregateScores,
  reliabilityTop5,
  uniformDist,
  rankOnlyDist,
} from './backtest';

describe('computeTerrainAffinity', () => {
  it('returns neutral (empty) when the sample is too thin', () => {
    const aff = computeTerrainAffinity([{ type: 'summit', rank: 1 }, { type: 'flat', rank: 40 }]);
    expect(aff).toEqual({});
  });

  it('lifts the terrain a rider over-performs on and sinks the rest', () => {
    // A rider who wins in the mountains but pack-fills on the flat.
    const results = [
      ...Array.from({ length: 8 }, () => ({ type: 'summit' as const, rank: 2 })),
      ...Array.from({ length: 8 }, () => ({ type: 'high_mtn' as const, rank: 3 })),
      ...Array.from({ length: 8 }, () => ({ type: 'flat' as const, rank: 80 })),
    ];
    const aff = computeTerrainAffinity(results);
    expect(aff.summit!).toBeGreaterThan(1);
    expect(aff.high_mtn!).toBeGreaterThan(1);
    expect(aff.flat!).toBeLessThan(1);
    // summit and high_mtn share the "mountain" family → same multiplier.
    expect(aff.summit!).toBeCloseTo(aff.high_mtn!, 6);
  });

  it('stays within the configured clamp', () => {
    const results = Array.from({ length: 40 }, () => ({ type: 'summit' as const, rank: 1 }));
    const aff = computeTerrainAffinity(results);
    // a pure-mountain winner with no other terrain has overall ≈ family → ~1.
    expect(aff.summit ?? 1).toBeLessThanOrEqual(1.7 + 1e-9);
  });
});

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

  it('terrain-specific form weights similar terrain higher', () => {
    // a rider with a recent strong MOUNTAIN result and a weak FLAT result:
    const results = [
      { date: '2026-06-10', rank: 1, level: 800, type: 'high_mtn' as const },
      { date: '2026-06-11', rank: 60, level: 800, type: 'flat' as const },
    ];
    const formForMtn = computeForm(results, '2026-06-20', 45, 'summit');
    const formForFlat = computeForm(results, '2026-06-20', 45, 'flat');
    // uphill the mountain win dominates; on the flat the poor flat result weighs more
    expect(formForMtn).toBeGreaterThan(formForFlat);
  });
});

describe('terrainSimilarity', () => {
  it('is 1 for same type and decays with distance on the climb axis', () => {
    expect(terrainSimilarity('summit', 'summit')).toBe(1);
    expect(terrainSimilarity('summit', 'high_mtn')).toBeGreaterThan(terrainSimilarity('summit', 'flat'));
    expect(terrainSimilarity('flat', 'high_mtn')).toBeLessThan(0.6);
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
