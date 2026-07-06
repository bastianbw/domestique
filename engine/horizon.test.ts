import { describe, it, expect } from 'vitest';
import { forwardValues, normalCdf, pSwapBeatsHold } from './horizon';
import { getStage } from './stages';
import { projectField } from './growth';
import type { Rider, Stage } from './types';

function rider(partial: Partial<Rider> & Pick<Rider, 'id' | 'archetype'>): Rider {
  return {
    name: partial.id, team: 'T', price: 8_000_000,
    form: 70, pcsRank: 30, teamStrength: 60, injury: 'fit',
    breakawayTendency: 20, ...partial,
  } as Rider;
}

describe('forwardValues — whole-race GC value beyond the near-term cap', () => {
  // Stage 1 → autoHorizonDepth caps the near-term window at 4 (stages 1-4).
  // The 2026 route has GC-relevant (summit/high_mtn/hilly_itt) stages well
  // beyond that (6, 10, 14, 15, 16, 18, 19, 20) that a proven GC leader's
  // value should now reach, discounted, instead of being invisible.
  const allStages: Stage[] = Array.from({ length: 21 }, (_, i) => getStage(i + 1)!);

  it('a strong GC leader gets real forward value from GC-relevant stages beyond the near-term cap', () => {
    const leader = rider({ id: 'leader', archetype: 'gc', pcsRank: 1, form: 95, gcPosition: 1 });
    const rest = ['a', 'b', 'c', 'd'].map((id, i) =>
      rider({ id, archetype: 'gc', pcsRank: 20 + i * 10, form: 70, gcPosition: i + 2 }),
    );
    const withFarGc = forwardValues([leader, ...rest], allStages, 1);
    const nearOnlyStages = allStages.filter((s) => s.stage <= 4);
    const nearOnly = forwardValues([leader, ...rest], nearOnlyStages, 1);
    // The whole-race version must value the leader strictly more than a
    // version that can only see the first 4 stages — the whole point of the
    // fix (GC value shouldn't vanish past the near-term cap).
    expect(withFarGc.values['leader']).toBeGreaterThan(nearOnly.values['leader']);
  });

  it('does not double-count: a race with no stages beyond the near-term cap is unaffected', () => {
    const leader = rider({ id: 'leader', archetype: 'gc', pcsRank: 1, form: 95, gcPosition: 1 });
    const shortRace = allStages.filter((s) => s.stage <= 4);
    const fv = forwardValues([leader], shortRace, 1);
    // no far stages exist, so nothing should be added beyond the near-term horizon value
    expect(fv.values['leader']).toBeCloseTo(fv.hv['leader'].value, 6);
  });

  it('a rider with no GC position gets no whole-race GC contribution', () => {
    const sprinter = rider({ id: 'spr', archetype: 'sprinter', pcsRank: 3, form: 90 });
    const fv = forwardValues([sprinter], allStages, 1);
    // sprinter has no gcPosition, so far-horizon GC stages contribute nothing —
    // forward value should equal the near-term (capped) horizon value exactly.
    expect(fv.values['spr']).toBeCloseTo(fv.hv['spr'].value, 6);
  });

  it('reusing an already-computed current-stage projection gives the identical result as recomputing it', () => {
    // The current stage is always upcomingStages[0] — a caller (the page)
    // that already ran projectField for display purposes can hand that in
    // instead of paying for the same Monte Carlo simulation twice.
    const field = [
      rider({ id: 'a', archetype: 'gc', pcsRank: 5, gcPosition: 3 }),
      rider({ id: 'b', archetype: 'sprinter', pcsRank: 10 }),
      rider({ id: 'c', archetype: 'climber', pcsRank: 20 }),
    ];
    const withoutReuse = forwardValues(field, allStages, 1);
    const precomputed = projectField(field, getStage(1)!);
    const withReuse = forwardValues(field, allStages, 1, undefined, precomputed);
    for (const r of field) {
      expect(withReuse.values[r.id]).toBeCloseTo(withoutReuse.values[r.id], 6);
      expect(withReuse.variances[r.id]).toBeCloseTo(withoutReuse.variances[r.id], 6);
    }
  });
});

describe('normalCdf', () => {
  it('is 0.5 at z=0 and approaches 0/1 at the tails', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(-10)).toBeCloseTo(0, 6);
    expect(normalCdf(10)).toBeCloseTo(1, 6);
  });

  it('matches the standard normal CDF at a known point (z=1 ≈ 0.8413)', () => {
    expect(normalCdf(1)).toBeCloseTo(0.8413, 3);
  });
});

describe('pSwapBeatsHold', () => {
  it('a huge mean edge with negligible variance is ~certain', () => {
    const p = pSwapBeatsHold(['sell'], ['buy'],
      { sell: 100_000, buy: 500_000 }, { sell: 1, buy: 1 }, 10_000);
    expect(p).toBeGreaterThan(0.999);
  });

  it('a small mean edge swamped by huge variance is close to a coin flip', () => {
    const p = pSwapBeatsHold(['sell'], ['buy'],
      { sell: 100_000, buy: 110_000 }, { sell: 5e11, buy: 5e11 }, 1_000);
    expect(p).toBeGreaterThan(0.5);
    expect(p).toBeLessThan(0.6);
  });

  it('a negative mean edge (fee outweighs the gain) is below even odds', () => {
    const p = pSwapBeatsHold(['sell'], ['buy'],
      { sell: 100_000, buy: 105_000 }, { sell: 1, buy: 1 }, 20_000);
    expect(p).toBeLessThan(0.01);
  });

  it('zero variance on both sides falls back to a hard yes/no on the mean', () => {
    expect(pSwapBeatsHold(['s'], ['b'], { s: 100, b: 200 }, { s: 0, b: 0 }, 0)).toBe(1);
    expect(pSwapBeatsHold(['s'], ['b'], { s: 200, b: 100 }, { s: 0, b: 0 }, 0)).toBe(0);
  });
});
