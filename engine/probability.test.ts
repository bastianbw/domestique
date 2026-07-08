import { describe, it, expect } from 'vitest';
import { buildField, devigMarket, devigShin, calibrateDistribution } from './probability';
import type { Rider, RiderOdds } from './types';
import { getStage } from './stages';

// All buildField tests below project stage 7, so odds are scoped to stage 7.
function rider(id: string, odds?: RiderOdds): Rider {
  return {
    id, name: id, team: 'T', archetype: 'sprinter', price: 8_000_000,
    form: 70, pcsRank: 30, teamStrength: 60, injury: 'fit',
    breakawayTendency: 20, oddsByStage: odds ? { 7: odds } : undefined,
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

describe('win-only paste — place probabilities implied by the market, not made up', () => {
  const flat = getStage(7)!;
  const topK = (probs: number[], k: number) => probs.slice(0, k).reduce((a, b) => a + b, 0);

  // A realistic win-only sheet: one clear favourite + 29 longshots, fully
  // covering the field (no unpriced riders → wOdds = 1, pure odds path).
  const field = [
    rider('fav', { win: 4.0 }),
    ...Array.from({ length: 29 }, (_, i) => rider(`long${i}`, { win: 40 })),
  ];

  it('a ~25% win favourite reads as a genuine top-5/top-15 contender, not a flat geometric tail', () => {
    // Old behaviour: only k=1 anchored; the rest spread with a near-flat decay
    // (the headStrength passed in is a tiny field share), giving the favourite
    // top-5 ≈ 0.38 — absurd for a rider the market rates 1-in-4 to WIN.
    const dists = buildField(field, flat);
    const fav = dists.find((d) => d.riderId === 'fav')!;
    expect(fav.probs[0]).toBeGreaterThan(0.2); // de-vigged win intact
    expect(topK(fav.probs, 5)).toBeGreaterThan(0.55); // Plackett–Luce implied
    // (≥, not >: in this small 30-rider field the favourite is already
    // near-certain top-10, so top-15 saturates at the same finishing mass)
    expect(topK(fav.probs, 15)).toBeGreaterThanOrEqual(topK(fav.probs, 10));
    expect(topK(fav.probs, 10)).toBeGreaterThan(topK(fav.probs, 5));
  });

  it('the implied place ladder still separates favourite from longshot', () => {
    const dists = buildField(field, flat);
    const fav = dists.find((d) => d.riderId === 'fav')!;
    const long = dists.find((d) => d.riderId === 'long0')!;
    expect(topK(fav.probs, 5)).toBeGreaterThan(topK(long.probs, 5) + 0.3);
  });

  it('a pasted place market always beats the Plackett–Luce fill where both exist', () => {
    // Same favourite but with an explicit (unusually pessimistic) top10 price.
    // The pasted number must anchor k=10 — PL is only for the missing markets.
    const withTop10 = [
      rider('fav', { win: 4.0, top10: 2.5 }), // implied 40% top-10, way below PL
      ...Array.from({ length: 29 }, (_, i) => rider(`long${i}`, { win: 40, top10: 8 })),
    ];
    const dists = buildField(withTop10, flat);
    const fav = dists.find((d) => d.riderId === 'fav')!;
    // devigMarket for k=10: S = 0.4 + 29×0.125 ≈ 4.02 < 10 → margin divisor 1.25.
    const expectedTop10 = 0.4 / 1.25;
    expect(topK(fav.probs, 10)).toBeLessThan(expectedTop10 + 0.01);
  });
});

describe('unpriced riders — absence from the paste is information', () => {
  const flat = getStage(7)!;

  it('an unpriced rider cannot out-rank the weakest priced rider at a pasted market', () => {
    // 20 priced (one favourite, 19 longshots) + 4 unpriced, one of them the
    // structurally STRONGEST rider in the field. Before the fix he kept his
    // full structural head mass and beat mid-market priced riders on xG.
    const priced = [
      rider('fav', { win: 3.0 }),
      ...Array.from({ length: 19 }, (_, i) => rider(`p${i}`, { win: 50 })),
    ];
    const star: Rider = { ...rider('star'), pcsRank: 1, form: 95 }; // unpriced!
    const others = ['u1', 'u2', 'u3'].map((id) => rider(id));
    const dists = buildField([...priced, star, ...others], flat);

    const winCol = [3.0, ...new Array(19).fill(50)];
    const minPricedWin = Math.min(...devigShin(winCol).filter((p) => p > 0));
    const starDist = dists.find((d) => d.riderId === 'star')!;
    expect(starDist.probs[0]).toBeLessThanOrEqual(minPricedWin + 1e-6);
  });
});

describe('calibrateDistribution', () => {
  const dist = { riderId: 'x', probs: [0.4, 0.2, 0.1, 0.05, 0.03], pDNF: 0.22 };
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

  it('γ=1 is identity', () => {
    expect(calibrateDistribution(dist, 1)).toBe(dist);
  });

  it('γ<1 flattens the head and preserves finishing + DNF mass', () => {
    const c = calibrateDistribution(dist, 0.85);
    expect(c.probs[0]).toBeLessThan(dist.probs[0]);      // peak pulled down
    expect(c.pDNF).toBeCloseTo(dist.pDNF, 10);           // DNF untouched
    expect(sum(c.probs)).toBeCloseTo(sum(dist.probs), 10); // finishing mass kept
  });

  it('γ>1 sharpens the head', () => {
    const c = calibrateDistribution(dist, 1.3);
    expect(c.probs[0]).toBeGreaterThan(dist.probs[0]);
    expect(sum(c.probs)).toBeCloseTo(sum(dist.probs), 10);
  });
});

describe('sparse-odds guard', () => {
  const flat = getStage(7)!;

  it('a lone short-odds favourite is not read as a near-certainty', () => {
    // One rider priced at ~evens, 30 others unpriced. Without the guard the win
    // de-vig normalises the single priced slot toward 1.0 → ~97% across markets.
    const field = [
      rider('lone', { win: 1.05 }),
      ...Array.from({ length: 30 }, (_, i) => rider(`f${i}`)),
    ];
    const dists = buildField(field, flat);
    const fav = dists.find((d) => d.riderId === 'lone')!;
    expect(fav.probs[0]).toBeLessThan(0.5); // tempered, not ~1.0
    // and the three markets no longer collapse onto the same number
    const pTop5 = fav.probs.slice(0, 5).reduce((a, b) => a + b, 0);
    const pTop15 = fav.probs.slice(0, 15).reduce((a, b) => a + b, 0);
    expect(pTop15).toBeGreaterThan(pTop5 + 1e-3);
    expect(pTop5).toBeGreaterThan(fav.probs[0] + 1e-3);
  });

  it('unpriced riders stay differentiated (not a flat fallback)', () => {
    // A strong sprinter and a weak domestique, neither priced, alongside one
    // priced favourite. Their structural strengths must still separate them.
    const sprinter = rider('sprint');
    const weak: Rider = { ...rider('weak'), archetype: 'domestique', pcsRank: 120, form: 55 };
    const field = [rider('fav', { win: 3.0 }), sprinter, weak,
      ...Array.from({ length: 20 }, (_, i) => rider(`f${i}`))];
    const dists = buildField(field, flat);
    const s = dists.find((d) => d.riderId === 'sprint')!.probs.slice(0, 5).reduce((a, b) => a + b, 0);
    const w = dists.find((d) => d.riderId === 'weak')!.probs.slice(0, 5).reduce((a, b) => a + b, 0);
    expect(s).toBeGreaterThan(w);
  });

  it('a fully-priced field is unchanged (odds stay the boss)', () => {
    // 12 riders all priced at win 12.0 → coverage 1 → Shin de-vig only, pWin 1/12.
    const field = Array.from({ length: 12 }, (_, i) => rider(`r${i}`, { win: 12.0 }));
    const dists = buildField(field, flat);
    for (const d of dists) expect(d.probs[0]).toBeCloseTo(1 / 12, 4);
  });

  it('a realistic ~184-rider field with a THOROUGH ~30-rider odds sheet is not still heavily diluted', () => {
    // Confirmed live: at the old ODDS_COVERAGE_REF=0.35, a bookmaker top-3
    // breakaway favourite (win 8.0) came out ~5x lower xG than with odds fully
    // trusted, because a bookmaker never prices the WHOLE field (only genuine
    // contenders) — 30/184 coverage only reached wOdds≈0.47 under the old
    // threshold. A rider priced as a live favourite should still read as
    // meaningfully live, not mostly-discarded, once ~30 real contenders are priced.
    // Realistic decimal odds: one clear favourite (implied 40%) + 29 longer
    // shots sharing the rest, summing to a believable ~10% bookmaker overround.
    const priced = [
      rider('fav', { win: 2.5 }), // implied 40%
      ...Array.from({ length: 29 }, (_, i) => rider(`priced${i}`, { win: 40 })), // implied ~2.5% each
    ];
    const unpriced = Array.from({ length: 154 }, (_, i) => rider(`u${i}`));
    const field = [...priced, ...unpriced];
    const dists = buildField(field, flat);
    const favourite = dists.find((d) => d.riderId === 'fav')!;
    // Shin de-vig removes the ~10% overround, so the favourite's true win
    // chance should land close to its 40% implied — not the ~15-25% a
    // heavily-diluted blend toward the flat structural prior would produce.
    expect(favourite.probs[0]).toBeGreaterThan(0.32);
  });
});
