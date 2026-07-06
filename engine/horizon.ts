// ── Smart rolling-horizon planning (§4, §8.4) ────────────────────────────────
// Don't just look a fixed 3 stages ahead — evaluate whichever upcoming stages
// actually matter for a rider, discount future growth, and make keep-vs-swap
// compare the multi-stage value of holding vs the fee to swap.

import type { Rider, Stage } from './types';
import { EngineConfig, defaultConfig, DEFAULT_HORIZON_DEPTH } from './config';
import { projectField, GC_RELEVANT_TYPES } from './growth';
import { transferFee } from './rules';
import { autoHorizonDepth } from './stages';

export interface HorizonValue {
  riderId: string;
  /** discounted sum of projected xG across the evaluated horizon */
  value: number;
  /** discounted (squared) sum of projected per-stage growth variance —
   *  how UNCERTAIN that value is, for the swap-confidence calc below */
  variance: number;
  /** per-stage projected xG (undiscounted), for the "why" explanation */
  perStage: Array<{ stage: number; xG: number }>;
  /** the stages that contributed most (xG above a threshold) */
  keyStages: number[];
}

/**
 * Compute discounted horizon value for every rider across `upcomingStages`.
 * Caches one field projection per stage (cheap) and aggregates per rider.
 */
export function horizonValues(
  riders: Rider[],
  upcomingStages: Stage[],
  cfg: EngineConfig = defaultConfig(),
  depth: number = DEFAULT_HORIZON_DEPTH,
): Record<string, HorizonValue> {
  const stages = upcomingStages.slice(0, depth);
  const projByStage = stages.map((s) => ({
    stage: s.stage,
    projs: projectField(riders, s, cfg),
  }));

  const out: Record<string, HorizonValue> = {};
  for (const r of riders) {
    let value = 0;
    let variance = 0;
    const perStage: HorizonValue['perStage'] = [];
    projByStage.forEach((entry, i) => {
      const p = entry.projs.find((x) => x.riderId === r.id);
      const xG = p?.xG ?? 0;
      const discount = Math.pow(cfg.horizonDiscount, i);
      value += xG * discount;
      variance += (p?.gVar ?? 0) * discount * discount; // Var(c·X) = c²Var(X)
      perStage.push({ stage: entry.stage, xG });
    });
    // Key stages = those whose xG is in the upper part of this rider's range.
    const maxX = Math.max(0, ...perStage.map((s) => s.xG));
    const keyStages = perStage
      .filter((s) => s.xG > 0.6 * maxX && s.xG > 0)
      .map((s) => s.stage);
    out[r.id] = { riderId: r.id, value, variance, perStage, keyStages };
  }
  return out;
}

/**
 * A GC contender's edge isn't a fresh day-to-day gamble like a stage-hunter's
 * — it's a persistent asset (holding a strong classification position keeps
 * paying out on every remaining GC-relevant stage to Paris, plus the final
 * overall). The block-capped near-term horizon below (autoHorizonDepth, capped
 * at 4) exists to stop FAR stage-win speculation from dominating the score —
 * reasonable for one-off stage-hunter value, which is genuinely front-loaded
 * and hard to project. But that same cap also hides a proven GC favourite's
 * value on every mountain stage past the next few days, which for a 21-stage
 * race is most of it. This adds that back as a separate term over the WHOLE
 * remaining route (not just the current block), discounted more gently than
 * per-stage form/odds risk since GC contention is far more persistent than
 * day-to-day stage form. Only counts stages beyond what the near-term horizon
 * already covers, so nothing is double-counted.
 */
function wholeRaceGc(
  riders: Rider[],
  farStages: Stage[],
  fromStage: number,
  cfg: EngineConfig,
): { value: Record<string, number>; variance: Record<string, number> } {
  const relevant = farStages.filter((s) => GC_RELEVANT_TYPES.has(s.type));
  const value: Record<string, number> = {};
  const variance: Record<string, number> = {};
  const gcDiscount = Math.sqrt(cfg.horizonDiscount); // decays slower than the per-stage discount
  for (const s of relevant) {
    // Analytic (no Monte Carlo) — this term is already a heavily-discounted,
    // many-stages-out estimate, so simulator-level precision isn't worth the
    // cost of running a full sim for every remaining mountain/ITT stage on
    // every recompute (this loop can cover 5-8+ stages at once).
    const projs = projectField(riders, s, cfg, { analytic: true });
    const discount = Math.pow(gcDiscount, s.stage - fromStage);
    for (const p of projs) {
      value[p.riderId] = (value[p.riderId] ?? 0) + discount * p.breakdown.gc;
      // The whole-race term only carries the GC component's own variance
      // (folded into gVar in growth.ts) — approximate as a fixed share of
      // total gVar proportional to the GC component's share of xG, since gVar
      // isn't broken down by component. When gc is 0 this contributes 0.
      const share = p.xG > 0 ? Math.min(1, Math.max(0, p.breakdown.gc) / Math.max(1e-6, Math.abs(p.xG))) : 0;
      variance[p.riderId] = (variance[p.riderId] ?? 0) + discount * discount * share * (p.gVar ?? 0);
    }
  }
  return { value, variance };
}

/**
 * Forward-looking selection value per rider for the optimizer: the discounted
 * sum of projected xG from `fromStage` to the next rest day (auto depth — no
 * user knob), PLUS a gently-discounted whole-race GC value for the mountain/
 * ITT stages beyond that block (see wholeRaceGc). Feed `values` into
 * OptimizerInput.forwardValueById so the squad is chosen for the rest of the
 * current block AND a proven GC favourite's season-long value, not just today.
 * `variances` (the matching uncertainty) feeds forwardVarianceById so the
 * optimizer can tell a confident edge from a coin flip (see pSwapBeatsHold).
 */
export function forwardValues(
  riders: Rider[],
  allStages: Stage[],
  fromStage: number,
  cfg: EngineConfig = defaultConfig(),
): {
  values: Record<string, number>;
  variances: Record<string, number>;
  hv: Record<string, HorizonValue>;
  depth: number;
  stages: number[];
} {
  const upcoming = allStages.filter((s) => s.stage >= fromStage);
  const depth = autoHorizonDepth(fromStage);
  const hv = horizonValues(riders, upcoming, cfg, depth);
  const nearTermEnd = fromStage + depth; // first stage NOT already covered by hv
  const farGc = wholeRaceGc(riders, allStages.filter((s) => s.stage >= nearTermEnd), fromStage, cfg);
  const values: Record<string, number> = {};
  const variances: Record<string, number> = {};
  for (const id of Object.keys(hv)) {
    values[id] = hv[id].value + (farGc.value[id] ?? 0);
    variances[id] = hv[id].variance + (farGc.variance[id] ?? 0);
  }
  return { values, variances, hv, depth, stages: upcoming.slice(0, depth).map((s) => s.stage) };
}

/** Standard normal CDF via the Abramowitz-Stegun erf approximation (max error ~1.5e-7). */
export function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/**
 * Probability that swapping `sellIds` for `buyIds` actually beats holding,
 * given each rider's forward value/variance (a normal approximation over the
 * combined, assumed-independent, per-rider stage outcomes). This is the
 * "85% sure, not just a marginally higher mean" check: a swap set with a
 * small positive expected edge but large combined uncertainty scores a LOW
 * probability here even though its raw expected value is nominally higher —
 * which is exactly the gap a pure mean-variance penalty misses (it discounts
 * the mean by a fixed multiple of σ, but never asks "how likely is this
 * actually an improvement").
 */
export function pSwapBeatsHold(
  sellIds: string[],
  buyIds: string[],
  valueById: Record<string, number>,
  varianceById: Record<string, number>,
  feeCost: number,
): number {
  const sellValue = sellIds.reduce((a, id) => a + (valueById[id] ?? 0), 0);
  const buyValue = buyIds.reduce((a, id) => a + (valueById[id] ?? 0), 0);
  const deltaMean = buyValue - sellValue - feeCost;
  const deltaVar =
    sellIds.reduce((a, id) => a + (varianceById[id] ?? 0), 0) +
    buyIds.reduce((a, id) => a + (varianceById[id] ?? 0), 0);
  if (deltaVar <= 1e-9) return deltaMean > 0 ? 1 : deltaMean < 0 ? 0 : 0.5;
  return normalCdf(deltaMean / Math.sqrt(deltaVar));
}

export interface KeepSwapDecision {
  keep: boolean;
  holdValue: number; // horizon value of keeping the held rider (no fee)
  swapValue: number; // horizon value of the candidate minus the fee to buy
  fee: number;
  /** human-readable reasoning */
  reason: string;
}

/**
 * Decide whether to keep `held` or swap to `candidate`, comparing multi-stage
 * value. The fee (1% of candidate price) is charged once, up front, against the
 * horizon gain — so a rider you'd drop tomorrow won't justify the fee.
 */
export function keepVsSwap(
  held: Rider,
  candidate: Rider,
  hv: Record<string, HorizonValue>,
): KeepSwapDecision {
  const holdValue = hv[held.id]?.value ?? 0;
  const fee = transferFee(candidate.price);
  const swapValue = (hv[candidate.id]?.value ?? 0) - fee;
  const keep = holdValue >= swapValue;

  const candKey = hv[candidate.id]?.keyStages ?? [];
  const heldKey = hv[held.id]?.keyStages ?? [];
  const reason = keep
    ? `Keep ${held.name}: horizon value ${fmt(holdValue)} ≥ ${candidate.name} ${fmt(swapValue)} after ${fmt(fee)} fee` +
      (heldKey.length ? ` (suits stages ${heldKey.join(', ')})` : '')
    : `Swap to ${candidate.name}: ${fmt(swapValue)} after ${fmt(fee)} fee > keeping ${held.name} ${fmt(holdValue)}` +
      (candKey.length ? ` (unlocks stages ${candKey.join(', ')})` : '');

  return { keep, holdValue, swapValue, fee, reason };
}

function fmt(n: number): string {
  return `${Math.round(n / 1000)}k`;
}
