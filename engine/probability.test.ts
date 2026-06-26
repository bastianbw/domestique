import { describe, it, expect } from 'vitest';
import { buildField, devigMarket } from './probability';
import type { Rider } from './types';
import { getStage } from './stages';

function rider(id: string, odds?: Rider['odds']): Rider {
  return {
    id, name: id, team: 'T', archetype: 'sprinter', price: 8_000_000,
    form: 70, pcsRank: 30, teamStrength: 60, injury: 'fit',
    breakawayTendency: 20, odds,
  };
}

describe('devigMarket', () => {
  it('discounts a sparse market by the fixed margin (no over-inflation)', () => {
    // Two favourites only → S = 1.0 < margin, so divide by the win margin 1.12.
    const q = devigMarket([2.0, 2.0], 1);
    expect(q[0]).toBeCloseTo(0.5 / 1.12, 5);
  });

  it('higher odds → lower implied probability', () => {
    const q = devigMarket([3, 6, 12], 1);
    expect(q[0]).toBeGreaterThan(q[1]);
    expect(q[1]).toBeGreaterThan(q[2]);
  });
});

describe('odds-ladder distribution', () => {
  const flat = getStage(7)!;

  it('pins pWin to the Shin de-vigged win odds', () => {
    // 12 riders, uniform win odds 12.0 → implied 1/12 each, S = 1.0 (no overround),
    // so Shin returns the exact implied 1/12 (no vig to remove).
    const field = Array.from({ length: 12 }, (_, i) => rider(`r${i}`, { win: 12.0 }));
    const dists = buildField(field, flat);
    const expected = 1 / 12;
    for (const d of dists) expect(d.probs[0]).toBeCloseTo(expected, 4);
  });

  it('keeps total probability mass at 1 and stays monotone (win ≤ top5 ≤ top15)', () => {
    const field = [
      rider('fav', { win: 4.0, top3: 1.8, top10: 1.2 }),
      ...Array.from({ length: 20 }, (_, i) => rider(`f${i}`, { win: 20 + i })),
    ];
    const dists = buildField(field, flat);
    for (const d of dists) {
      const total = d.probs.reduce((a, b) => a + b, 0) + d.pDNF;
      expect(total).toBeCloseTo(1, 4);
    }
    const fav = dists.find((d) => d.riderId === 'fav')!;
    const pWin = fav.probs[0];
    const pTop5 = fav.probs.slice(0, 5).reduce((a, b) => a + b, 0);
    const pTop15 = fav.probs.slice(0, 15).reduce((a, b) => a + b, 0);
    expect(pTop5).toBeGreaterThanOrEqual(pWin);
    expect(pTop15).toBeGreaterThanOrEqual(pTop5);
  });
});
