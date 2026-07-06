import { describe, it, expect } from 'vitest';
import { optimize, expectedEtapebonus, scoreTeam } from './optimizer';
import type { Rider, RiderProjection, OptimizerInput, GrowthBreakdown, JointSamples } from './types';
import { getStage } from './stages';
import { etapebonus } from './rules';
import { pSwapBeatsHold } from './horizon';

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

function proj(id: string, xG: number, pTop15 = 0.3, pTop5 = 0.1, pWin = 0.02, gVar = xG * xG): RiderProjection {
  return {
    riderId: id, xG, pWin, pTop5, pTop15,
    captainEV: xG + Math.max(0, xG),
    gVar,
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

  it('balanced is the expected-value maximum; safe/aggressive trade EV for risk shape', () => {
    const inp = baseInput();
    const balanced = optimize({ ...inp, risk: 'balanced' });
    const safe = optimize({ ...inp, risk: 'safe' });
    const aggressive = optimize({ ...inp, risk: 'aggressive' });
    // Balanced maximises pure expected value, so it leads (allow tiny local-search slack).
    expect(balanced.expectedValue).toBeGreaterThanOrEqual(safe.expectedValue - 1);
    expect(balanced.expectedValue).toBeGreaterThanOrEqual(aggressive.expectedValue - 1);
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

  it('always fills 8 even when the best-value riders are expensive (ITT regression)', () => {
    // 4 expensive high-density riders + cheap filler. A non-reserving greedy would
    // spend the whole 50M on ~5 expensive riders and strand the team below 8.
    const riders: Rider[] = [];
    const projections: RiderProjection[] = [];
    for (let i = 0; i < 4; i++) {
      riders.push(rider(`X${i}`, `X${i}`, 11_000_000));
      projections.push(proj(`X${i}`, 400_000)); // very high xG → top value density
    }
    for (let i = 0; i < 10; i++) {
      riders.push(rider(`c${i}`, `c${i}`, 3_000_000));
      projections.push(proj(`c${i}`, 40_000));
    }
    const t = optimize(baseInput({ riders, projections, budget: 50_000_000 }));
    expect(t.riderIds.length).toBe(8);
    expect(t.spend).toBeLessThanOrEqual(50_000_000);
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

describe('risk presets actually change the team (mean-variance)', () => {
  // "steady" riders: same EV but LOW variance; "boom" riders: same EV but HIGH
  // variance + high P(win). Safe (variance penalty) should prefer steady;
  // Aggressive (win/ceiling tilt) should prefer boom. 6 teams leave room.
  function riskField() {
    const riders: Rider[] = [];
    const projections: RiderProjection[] = [];
    const teams = ['A', 'B', 'C', 'D', 'E', 'F'];
    for (const t of teams) {
      // steady: low variance, low win
      riders.push(rider(`${t}c`, t, 5_000_000));
      projections.push(proj(`${t}c`, 100_000, /*top15*/ 0.85, /*top5*/ 0.2, /*win*/ 0.02, /*gVar*/ 1e9));
      // boom: high variance, high win, same EV
      riders.push(rider(`${t}b`, t, 5_000_000));
      projections.push(proj(`${t}b`, 100_000, /*top15*/ 0.4, /*top5*/ 0.3, /*win*/ 0.25, /*gVar*/ 4e10));
    }
    return { riders, projections };
  }

  it('Safe favours low-variance riders; Aggressive favours high-win riders', () => {
    const { riders, projections } = riskField();
    const mk = (risk: 'safe' | 'balanced' | 'aggressive') =>
      optimize(baseInput({ riders, projections, risk }));

    const safe = mk('safe');
    const aggressive = mk('aggressive');

    const steadyCount = (ids: string[]) => ids.filter((id) => id.endsWith('c')).length;
    const boomCount = (ids: string[]) => ids.filter((id) => id.endsWith('b')).length;

    expect(steadyCount(safe.riderIds)).toBeGreaterThan(steadyCount(aggressive.riderIds));
    expect(boomCount(aggressive.riderIds)).toBeGreaterThan(boomCount(safe.riderIds));
    expect(safe.riderIds.slice().sort().join()).not.toBe(aggressive.riderIds.slice().sort().join());
  });
});

describe('swap confidence gate (forwardValueById + forwardVarianceById)', () => {
  // 8 current riders (2 per team, 4 teams) all with identical immediate xG/gVar
  // (so captain/Etapebonus/existing variance-penalty terms can't confound the
  // result) but a uniform forward SELECTION value of 100k. One outside
  // candidate, Z0, has a MUCH higher forward value (300k) — a 200k edge, large
  // enough that even 'safe's existing churn/variance penalties (which act on
  // score, not confidence) don't block the swap on their own. But both Z0 and
  // whichever current rider it displaces carry huge forwardVarianceById, so
  // the edge — while nominally positive — isn't a confident one.
  function confidenceField() {
    const teams = ['A', 'B', 'C', 'D'];
    const riders: Rider[] = [];
    const projections: RiderProjection[] = [];
    const forwardValueById: Record<string, number> = {};
    const forwardVarianceById: Record<string, number> = {};
    for (const t of teams) {
      for (let j = 0; j < 2; j++) {
        const id = `${t}${j}`;
        riders.push(rider(id, t, 1_000_000));
        projections.push(proj(id, 50_000, 0.3, 0.1, 0.02, 1)); // gVar≈0: isolate the new gate from the existing variance penalty
        forwardValueById[id] = 100_000;
        forwardVarianceById[id] = 2e12; // huge — held riders' true forward value is uncertain too
      }
    }
    riders.push(rider('Z0', 'Z', 1_000_000));
    projections.push(proj('Z0', 50_000, 0.3, 0.1, 0.02, 1));
    forwardValueById['Z0'] = 300_000; // +200k edge — big enough to clear fees/churn penalty on score alone
    forwardVarianceById['Z0'] = 2e12; // huge — the swap's real edge is uncertain, not free money
    const currentTeam = teams.flatMap((t) => [`${t}0`, `${t}1`]);
    return { riders, projections, forwardValueById, forwardVarianceById, currentTeam };
  }

  it('balanced takes the swap — positive edge, and balanced has no confidence bar', () => {
    const { riders, projections, forwardValueById, forwardVarianceById, currentTeam } = confidenceField();
    const t = optimize(baseInput({
      riders, projections, forwardValueById, forwardVarianceById,
      currentTeam, risk: 'balanced', budget: 50_000_000,
    }));
    expect(t.buys).toEqual(['Z0']);
    expect(t.sells.length).toBe(1);
    expect(t.swapConfidence).toBeDefined();
    // Positive edge (barely above a coin flip given the huge variance) — not the
    // near-certainty a naive "mean is higher" comparison would imply.
    expect(t.swapConfidence!).toBeGreaterThan(0.5);
    expect(t.swapConfidence!).toBeLessThan(0.65);
  });

  it('safe refuses the same swap — not confident enough — and holds the current team', () => {
    const { riders, projections, forwardValueById, forwardVarianceById, currentTeam } = confidenceField();
    const t = optimize(baseInput({
      riders, projections, forwardValueById, forwardVarianceById,
      currentTeam, risk: 'safe', budget: 50_000_000,
    }));
    // ...so 'safe' (minSwapConfidence 0.65) declines it and keeps the current 8,
    // even though the swap's raw score (mean edge minus fee/churn penalty) is
    // comfortably positive — the gate rejects it PER-SWAP inside the search
    // itself, so the low-confidence team is never assembled at all (reported
    // confidence is 1: "unchanged", not a rejected value) — a stronger
    // guarantee than reverting to hold only after the fact.
    expect(t.buys).toEqual([]);
    expect(t.sells).toEqual([]);
    expect(t.riderIds.slice().sort()).toEqual(currentTeam.slice().sort());
    expect(t.swapConfidence).toBe(1);
  });

  it('a clearly-better, low-variance swap is confident and safe accepts it too', () => {
    const { riders, projections, forwardValueById, forwardVarianceById, currentTeam } = confidenceField();
    // Same edge, but make it a sure thing: tiny variance on both sides.
    forwardVarianceById['Z0'] = 1;
    for (const id of currentTeam) forwardVarianceById[id] = 1;
    const t = optimize(baseInput({
      riders, projections, forwardValueById, forwardVarianceById,
      currentTeam, risk: 'safe', budget: 50_000_000,
    }));
    expect(t.buys).toEqual(['Z0']);
    expect(t.swapConfidence!).toBeGreaterThan(0.99);
  });

  it('a bundle of two individually-unconfident swaps must not sneak past Safe just because it looks confident in AGGREGATE', () => {
    // Two SEPARATE held riders, each with its own candidate replacement. Each
    // swap alone is a real edge but genuinely uncertain (~62% — a coin-flip-
    // ish edge, well under Safe's 65% bar). Bundling two i.i.d. edges together
    // shrinks RELATIVE uncertainty (variance adds, mean adds faster in
    // aggregate) enough to nominally clear 65% as a bundle — exactly the trap
    // an aggregate-only confidence check would fall for. The optimizer must
    // gate each swap on its OWN merits and reject both, not let them launder
    // each other's uncertainty away.
    const teams = ['A', 'B', 'C', 'D'];
    const riders: Rider[] = [];
    const projections: RiderProjection[] = [];
    const forwardValueById: Record<string, number> = {};
    const forwardVarianceById: Record<string, number> = {};
    for (const t of teams) {
      for (let j = 0; j < 2; j++) {
        const id = `${t}${j}`;
        riders.push(rider(id, t, 1_000_000));
        projections.push(proj(id, 50_000, 0.3, 0.1, 0.02, 1));
        forwardValueById[id] = 100_000;
        forwardVarianceById[id] = 4.5e10;
      }
    }
    const currentTeam = teams.flatMap((t) => [`${t}0`, `${t}1`]);
    // Two independent candidates, each an individually ~62%-confident swap
    // (z = 90k / sqrt(9e10) = 0.3 → Φ(0.3) ≈ 0.618 < 0.65) against WHICHEVER
    // held rider they'd replace (all held riders are identical here).
    for (const cid of ['Y0', 'Y1']) {
      riders.push(rider(cid, 'Y', 1_000_000));
      projections.push(proj(cid, 50_000, 0.3, 0.1, 0.02, 1));
      forwardValueById[cid] = 200_000; // net edge 90k over a held rider after the 10k fee (200k - 100k - 10k)
      forwardVarianceById[cid] = 4.5e10;
    }

    // Sanity check the trap is real: the AGGREGATE (both swaps at once) reads
    // as confident even though neither swap is, on its own.
    const singleConf = pSwapBeatsHold(['A0'], ['Y0'], forwardValueById, forwardVarianceById, 10_000);
    const bundleConf = pSwapBeatsHold(['A0', 'B0'], ['Y0', 'Y1'], forwardValueById, forwardVarianceById, 20_000);
    expect(singleConf).toBeLessThan(0.65);
    expect(bundleConf).toBeGreaterThan(0.65);

    const t = optimize(baseInput({
      riders, projections, forwardValueById, forwardVarianceById,
      currentTeam, risk: 'safe', budget: 50_000_000,
    }));
    // The real optimizer must NOT take either swap.
    expect(t.buys).toEqual([]);
    expect(t.sells).toEqual([]);
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
