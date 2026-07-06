import { describe, it, expect } from 'vitest';
import { forwardValues } from './horizon';
import { getStage } from './stages';
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
});
