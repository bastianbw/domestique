import { describe, it, expect } from 'vitest';
import { eloExpected, priorRating, ratingToRank, updateStage, ELO_BASE } from './elo';

describe('elo', () => {
  it('expected score is 0.5 for equal ratings and rises with the gap', () => {
    expect(eloExpected(1500, 1500)).toBeCloseTo(0.5, 6);
    expect(eloExpected(1700, 1500)).toBeGreaterThan(0.5);
    expect(eloExpected(1300, 1500)).toBeLessThan(0.5);
  });

  it('priorRating and ratingToRank are rough inverses', () => {
    for (const rank of [1, 10, 50, 100]) {
      expect(ratingToRank(priorRating(rank))).toBeCloseTo(rank, 0);
    }
    expect(ratingToRank(ELO_BASE - 50)).toBe(300); // at/below baseline → journeyman
  });

  it('a win raises rating, a loss lowers it, and the update is ~zero-sum', () => {
    const r = new Map([['a', 1500], ['b', 1500], ['c', 1500]]);
    const before = [...r.values()].reduce((x, y) => x + y, 0);
    updateStage(r, ['a', 'b', 'c']); // a beats b beats c
    expect(r.get('a')!).toBeGreaterThan(1500);
    expect(r.get('c')!).toBeLessThan(1500);
    expect(r.get('b')!).toBeCloseTo(1500, 4); // middle ≈ unchanged
    const after = [...r.values()].reduce((x, y) => x + y, 0);
    expect(after).toBeCloseTo(before, 4); // conserved
  });

  it('repeatedly beating the field grows a rider above the field', () => {
    const r = new Map([['star', 1500], ['x', 1500], ['y', 1500], ['z', 1500]]);
    for (let i = 0; i < 20; i++) updateStage(r, ['star', 'x', 'y', 'z']);
    expect(r.get('star')!).toBeGreaterThan(1600);
  });
});
