import { describe, it, expect } from 'vitest';
import { optimize, expectedEtapebonus, scoreTeam } from './optimizer';
import type { Rider, RiderProjection, OptimizerInput, GrowthBreakdown, JointSamples } from './types';
import { getStage } from './stages';
import { etapebonus } from './rules';

const ZERO_BREAKDOWN: GrowthBreakdown = {
  placement: 0, sprintMtn: 0, gc: 0, jerseys: 0,
  holdbonus: 0, lateArrival: 0, dnfRisk: 0, ttt: 0,
};

function rider(id: string, team: string, price: number, partial: Partial<Rider> = {}): Rider {
  return {
    id, name: id, team, archetype: 'sprinter', price,
    form: 70, pcsRank: 20, teamStrength: 60, injury: 'fit',
    breakawayTendency: 10, ...partial,
  };
}

function proj(id: string, xG: number, pTop15 = 0.3, pTop5 = 0.1, pWin = 0.02): RiderProjection {
  return {
    riderId: id, xG, pWin, pTop5, pTop15,
    captainEV: xG + Math.max(0, xG),
    breakdown: { ...ZERO_BREAKDOWN, placement: xG },
  };
}

// 20 riders across 5 teams, 4 per team.
function makeField() {
  const riders: Rider[] = [];
  const projections: RiderProjection[] = [];
  const teams = ['A', 'B', 'C', 'D', 'E'];
  let i = 0;
  for (const t of teams) {
    for (let j = 0; j < 4; j++) {
      const id = `${t}${j}`;
      // give team A's riders the highest xG so the 2-per-team cap bites
      const xG = t === 'A' ? 300_000 - j * 1000 : 100_000 - j * 1000 - teams.indexOf(t) * 5000;
      riders.push(rider(id, t, 5_000_000));
      projections.push(proj(id, xG, 0.4));
      i++;
    }
  }
  return { riders, projections };
}

function baseInput(over: Partial<OptimizerInput> = {}): OptimizerInput {
  const { riders, projections } = makeField();
  return {
    stage: getStage(7)!,
    riders, projections,
    budget: 50_000_000,
    teamType: 'guld',
    contractsRemaining: Infinity,
    risk: 'balanced',
    ...over,
  };
}

describe('optimizer', () => {
  it('selects exactly 8 riders', () => {
    const t = optimize(baseInput());
    expect(t.riderIds.length).toBe(8);
  });

  it('never exceeds 2 riders per team', () => {
    const t = optimize(baseInput());
    const counts: Record<string, number> = {};
    for (const id of t.riderIds) {
      const team = id[0];
      counts[team] = (counts[team] ?? 0) + 1;
    }
    expect(Object.values(counts).every((c) => c <= 2)).toBe(true);
    // Team A had the best riders → cap should force exactly 2 of them.
    expect(counts['A']).toBe(2);
  });

  it('scores Etapebonus jointly when sim samples are supplied', () => {
    const { riders } = makeField();
    const starterIds = riders.map((r) => r.id);
    // A FIXED top-15 every sim (first 15 starters) → joint Etapebonus is exactly
    // etapebonus(count of chosen riders in that set); the Poisson-binomial path
    // would instead give a smeared, non-tier value.
    const top15idx = starterIds.map((_, i) => i).slice(0, 15);
    const nSims = 50;
    const samples: JointSamples = {
      starterIds, nSims,
      top15: Array.from({ length: nSims }, () => [...top15idx]),
      winner: new Array(nSims).fill(0),
    };
    const t = optimize(baseInput({ jointSamples: samples }));
    const inSet = new Set(top15idx);
    const chosenInTop15 = t.riderIds.filter((id) => inSet.has(starterIds.indexOf(id))).length;
    expect(t.expectedEtapebonus).toBeCloseTo(etapebonus(chosenInTop15), 6);
  });

  it('respects the budget', () => {
    // 8 riders at 5M each = 40M; budget exactly affords a legal team.
    const t = optimize(baseInput({ budget: 40_000_000 }));
    expect(t.spend).toBeLessThanOrEqual(40_000_000);
    expect(t.riderIds.length).toBe(8);
  });

  it('excludes riders it cannot afford under a tight budget', () => {
    const { riders, projections } = (() => {
      const input = baseInput();
      // Make A0 (best xG) very expensive so a tight budget must skip it.
      const rs = input.riders.map((r) =>
        r.id === 'A0' ? { ...r, price: 30_000_000 } : r,
      );
      return { riders: rs, projections: input.projections };
    })();
    const t = optimize(baseInput({ riders, projections, budget: 40_000_000 }));
    expect(t.riderIds).not.toContain('A0');
    expect(t.spend).toBeLessThanOrEqual(40_000_000);
  });

  it('captains the highest-xG selected rider and doubles its positive growth', () => {
    const t = optimize(baseInput());
    // A0 has the highest xG (300k) and must be selected & captained.
    expect(t.riderIds).toContain('A0');
    expect(t.captainId).toBe('A0');
    expect(t.captainBonus).toBe(300_000);
  });

  it('charges transfer fees only for non-owned buys', () => {
    const owned = ['A0', 'A1', 'B0', 'B1', 'C0', 'C1', 'D0', 'D1'];
    const t = optimize(baseInput({ currentTeam: owned }));
    // fee = 1% of price for each bought (non-owned) rider
    expect(t.transferFees).toBeCloseTo(t.buys.length * 50_000, 0);
  });

  it('respects contract budget in Basis mode', () => {
    // A legal current team (≤2/team) that excludes the strong team A riders, so
    // the optimizer WANTS to swap them in but only has 1 contract to spend.
    const owned = ['B0', 'B1', 'C0', 'C1', 'D0', 'D1', 'E0', 'E1'];
    const t = optimize(baseInput({
      currentTeam: owned, teamType: 'basis', contractsRemaining: 1,
    }));
    expect(t.buys.length).toBeLessThanOrEqual(1);
    // and it should use that one contract to bring in the best available rider
    expect(t.buys.length).toBe(1);
    expect(t.riderIds).toContain('A0');
  });
});

describe('risk presets actually change the team (regression)', () => {
  // Build a field where "consistent" riders (high P(top15), modest xG) and
  // "boom" riders (high P(win), spiky xG) are distinct, so Safe and Aggressive
  // should diverge. 5 teams so the 2-per-team rule leaves room.
  function riskField() {
    const riders: Rider[] = [];
    const projections: RiderProjection[] = [];
    const teams = ['A', 'B', 'C', 'D', 'E', 'F'];
    for (const t of teams) {
      // consistent: high top15, low win
      riders.push(rider(`${t}c`, t, 5_000_000));
      projections.push(proj(`${t}c`, 90_000, /*top15*/ 0.85, /*top5*/ 0.2, /*win*/ 0.01));
      // boom: lower top15, high win + higher xG ceiling
      riders.push(rider(`${t}b`, t, 5_000_000));
      projections.push(proj(`${t}b`, 110_000, /*top15*/ 0.35, /*top5*/ 0.25, /*win*/ 0.18));
    }
    return { riders, projections };
  }

  it('Safe favours consistent (top-15) riders; Aggressive favours boom (win) riders', () => {
    const { riders, projections } = riskField();
    const mk = (risk: 'safe' | 'balanced' | 'aggressive') =>
      optimize(baseInput({ riders, projections, risk }));

    const safe = mk('safe');
    const aggressive = mk('aggressive');

    const consistentCount = (ids: string[]) => ids.filter((id) => id.endsWith('c')).length;
    const boomCount = (ids: string[]) => ids.filter((id) => id.endsWith('b')).length;

    expect(consistentCount(safe.riderIds)).toBeGreaterThan(consistentCount(aggressive.riderIds));
    expect(boomCount(aggressive.riderIds)).toBeGreaterThan(boomCount(safe.riderIds));
    // and the selected teams must not be identical
    expect(safe.riderIds.slice().sort().join()).not.toBe(aggressive.riderIds.slice().sort().join());
  });
});

describe('expectedEtapebonus (Poisson-binomial)', () => {
  it('is 0 when nobody can reach top-15', () => {
    expect(expectedEtapebonus([0, 0, 0, 0, 0, 0, 0, 0])).toBe(0);
  });

  it('equals the 8-tier payout when all are certain top-15', () => {
    expect(expectedEtapebonus([1, 1, 1, 1, 1, 1, 1, 1])).toBe(400_000);
  });

  it('is between tiers for partial probabilities', () => {
    const e = expectedEtapebonus([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
    expect(e).toBeGreaterThan(0);
    expect(e).toBeLessThan(400_000);
  });
});
