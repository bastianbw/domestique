// ── Team optimizer (§4) ──────────────────────────────────────────────────────
// Budget-constrained subset selection: 8 riders, ≤ budget, ≤ 2 per team,
// contract budget if Basis, maximising team NET growth including captain choice
// and EXPECTED Etapebonus. Greedy value-density seed + local-search swaps.

import type {
  Rider,
  RiderProjection,
  OptimizerInput,
  OptimizedTeam,
} from './types';
import { etapebonus, transferFee, ETAPEBONUS_TABLE } from './rules';
import { defaultConfig } from './config';

const TEAM_SIZE = 8;
const MAX_PER_TEAM = 2;

/**
 * Expected Etapebonus over the Poisson-binomial distribution of "how many of
 * my 8 riders finish top-15". Exact via DP — cheap for 8 riders, and far more
 * accurate than plugging the mean count into the tiered table.
 */
export function expectedEtapebonus(pTop15s: number[]): number {
  // pmf[k] = P(exactly k riders in top-15)
  let pmf = [1];
  for (const p of pTop15s) {
    const next = new Array(pmf.length + 1).fill(0);
    for (let k = 0; k < pmf.length; k++) {
      next[k] += pmf[k] * (1 - p);
      next[k + 1] += pmf[k] * p;
    }
    pmf = next;
  }
  let e = 0;
  for (let k = 0; k < pmf.length; k++) e += pmf[k] * etapebonus(k);
  return e;
}

interface ScoreContext {
  input: OptimizerInput;
  projById: Map<string, RiderProjection>;
  riderById: Map<string, Rider>;
}

function buildContext(input: OptimizerInput): ScoreContext {
  return {
    input,
    projById: new Map(input.projections.map((p) => [p.riderId, p])),
    riderById: new Map(input.riders.map((r) => [r.id, r])),
  };
}

/** Full metrics + objective score for a candidate set of rider ids. */
export function scoreTeam(ctx: ScoreContext, riderIds: string[]): OptimizedTeam {
  const { input, projById, riderById } = ctx;
  const cfg = defaultConfig();
  const risk = cfg.riskTuning[input.risk];
  const owned = new Set(input.currentTeam ?? []);

  const projs = riderIds.map((id) => projById.get(id)!);
  const riders = riderIds.map((id) => riderById.get(id)!);

  const expectedGrowth = projs.reduce((a, p) => a + p.xG, 0);

  // Best captain = the selected rider with the highest positive xG. Their
  // positive growth is paid again.
  let captainId = riderIds[0];
  let bestXg = -Infinity;
  for (const p of projs) {
    if (p.xG > bestXg) { bestXg = p.xG; captainId = p.riderId; }
  }
  const captainBonus = Math.max(0, bestXg);

  const expectedEtape = expectedEtapebonus(projs.map((p) => p.pTop15));
  const expectedHold = projs.reduce((a, p) => a + p.breakdown.holdbonus, 0);

  // Transfer fees: 1% of price for any rider NOT already owned.
  const buys = riderIds.filter((id) => !owned.has(id));
  const sells = [...owned].filter((id) => !riderIds.includes(id));
  const transferFees = buys.reduce(
    (a, id) => a + transferFee(riderById.get(id)!.price),
    0,
  );

  const spend = riders.reduce((a, r) => a + r.price, 0);

  const expectedGrowthAfterFees =
    expectedGrowth + captainBonus + expectedEtape - transferFees;

  // ── Objective with risk + differential reshaping ──
  // Risk weights are DKK-scaled (see config) so they genuinely shift the team:
  // 'safe' tilts toward consistent top-15 riders, 'aggressive' toward winners.
  let score = expectedGrowthAfterFees;

  if (risk.top15Weight) {
    const sumTop15 = projs.reduce((a, p) => a + p.pTop15, 0);
    score += risk.top15Weight * sumTop15;
  }
  if (risk.winWeight) {
    const sumWin = projs.reduce((a, p) => a + p.pWin, 0);
    score += risk.winWeight * sumWin;
  }
  if (input.differential) {
    // Lean away from heavily-owned "template" riders: penalise ownership,
    // reward leverage from contrarian picks.
    const ownPenalty = riders.reduce(
      (a, r) => a + (r.ownershipPct ?? 0) / 100,
      0,
    );
    score -= cfg.ownershipLeverage * ownPenalty * ETAPEBONUS_TABLE[3];
  }

  return {
    riderIds: [...riderIds],
    captainId,
    expectedGrowth,
    expectedGrowthAfterFees,
    captainBonus,
    expectedEtapebonus: expectedEtape,
    expectedHoldbonus: expectedHold,
    transferFees,
    contractsUsed: buys.length,
    spend,
    bankLeft: input.budget - spend,
    sells,
    buys,
    netGainVsHold: 0, // filled by caller relative to the hold baseline
    score,
  };
}

function teamCounts(riderIds: string[], riderById: Map<string, Rider>) {
  const counts: Record<string, number> = {};
  for (const id of riderIds) {
    const t = riderById.get(id)!.team;
    counts[t] = (counts[t] ?? 0) + 1;
  }
  return counts;
}

function isLegal(
  ctx: ScoreContext,
  riderIds: string[],
): boolean {
  const { input, riderById } = ctx;
  if (riderIds.length !== TEAM_SIZE) return false;
  const riders = riderIds.map((id) => riderById.get(id)!);
  // budget
  const spend = riders.reduce((a, r) => a + r.price, 0);
  if (spend > input.budget) return false;
  // ≤2 per team
  const counts = teamCounts(riderIds, riderById);
  if (Object.values(counts).some((c) => c > MAX_PER_TEAM)) return false;
  // contract budget (Basis): number of buys ≤ contractsRemaining
  if (Number.isFinite(input.contractsRemaining)) {
    const owned = new Set(input.currentTeam ?? []);
    const buys = riderIds.filter((id) => !owned.has(id)).length;
    if (buys > input.contractsRemaining) return false;
  }
  return true;
}

/**
 * Optimize. Greedy value-density seed (xG per kr, honouring 2-per-team and
 * budget) then local-search swaps to climb the objective. Runs instantly on
 * ~180 riders.
 */
export function optimize(input: OptimizerInput): OptimizedTeam {
  const ctx = buildContext(input);
  const { riderById } = ctx;

  // Candidate pool: starters only (injury 'out' projects to ~0 and shouldn't
  // be bought), sorted by value density.
  const pool = input.riders
    .filter((r) => r.injury !== 'out')
    .map((r) => ({
      id: r.id,
      team: r.team,
      price: r.price,
      proj: ctx.projById.get(r.id)!,
      density: ctx.projById.get(r.id)!.xG / Math.max(1, r.price),
    }))
    .sort((a, b) => b.density - a.density);

  // ── Seed ──
  // When contracts are limited (Basis), start from the current team so the
  // contract budget is respected from a feasible point; local search then makes
  // only as many swaps as contracts allow. Otherwise greedy value-density seed.
  const seedFromOwned =
    Number.isFinite(input.contractsRemaining) &&
    input.currentTeam?.length === TEAM_SIZE &&
    isLegal(ctx, input.currentTeam);

  if (seedFromOwned) {
    let current = [...input.currentTeam!];
    let currentScore = scoreTeam(ctx, current).score;
    const poolIds = pool.map((p) => p.id);
    let improved = true;
    let guard = 0;
    while (improved && guard++ < 50) {
      improved = false;
      for (let i = 0; i < current.length; i++) {
        for (const cand of poolIds) {
          if (current.includes(cand)) continue;
          const next = [...current];
          next[i] = cand;
          if (!isLegal(ctx, next)) continue;
          const s = scoreTeam(ctx, next).score;
          if (s > currentScore + 1e-6) {
            current = next; currentScore = s; improved = true;
          }
        }
      }
    }
    const result = scoreTeam(ctx, current);
    const hold = scoreTeam(ctx, input.currentTeam!);
    result.netGainVsHold = result.score - hold.score;
    return result;
  }

  // ── Greedy value-density seed honouring constraints ──
  const chosen: string[] = [];
  const counts: Record<string, number> = {};
  let spend = 0;
  for (const c of pool) {
    if (chosen.length >= TEAM_SIZE) break;
    if ((counts[c.team] ?? 0) >= MAX_PER_TEAM) continue;
    if (spend + c.price > input.budget) continue;
    chosen.push(c.id);
    counts[c.team] = (counts[c.team] ?? 0) + 1;
    spend += c.price;
  }
  // If greedy under-filled (budget too tight near the end), backfill cheapest.
  if (chosen.length < TEAM_SIZE) {
    const byPrice = [...pool].sort((a, b) => a.price - b.price);
    for (const c of byPrice) {
      if (chosen.length >= TEAM_SIZE) break;
      if (chosen.includes(c.id)) continue;
      if ((counts[c.team] ?? 0) >= MAX_PER_TEAM) continue;
      if (spend + c.price > input.budget) continue;
      chosen.push(c.id);
      counts[c.team] = (counts[c.team] ?? 0) + 1;
      spend += c.price;
    }
  }

  let current = chosen;
  let currentScore = scoreTeam(ctx, current).score;

  // ── Local search: try replacing each held rider with each pool rider ──
  const poolIds = pool.map((p) => p.id);
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 50) {
    improved = false;
    for (let i = 0; i < current.length; i++) {
      for (const cand of poolIds) {
        if (current.includes(cand)) continue;
        const next = [...current];
        next[i] = cand;
        if (!isLegal(ctx, next)) continue;
        const s = scoreTeam(ctx, next).score;
        if (s > currentScore + 1e-6) {
          current = next;
          currentScore = s;
          improved = true;
        }
      }
    }
  }

  const result = scoreTeam(ctx, current);

  // net gain vs standing pat: score of keeping the exact current team (if legal)
  if (input.currentTeam && input.currentTeam.length === TEAM_SIZE) {
    const holdLegal = isLegal(ctx, input.currentTeam);
    if (holdLegal) {
      const hold = scoreTeam(ctx, input.currentTeam);
      result.netGainVsHold = result.score - hold.score;
    } else {
      result.netGainVsHold = result.score; // current team not held intact anyway
    }
  }

  return result;
}

/**
 * "Best XI from what I already own" — zero fees, just the best captain over the
 * current team (no buys). Useful for the keep-vs-swap comparison.
 */
export function bestFromOwned(input: OptimizerInput): OptimizedTeam | null {
  if (!input.currentTeam || input.currentTeam.length !== TEAM_SIZE) return null;
  const ctx = buildContext(input);
  return scoreTeam(ctx, input.currentTeam);
}
