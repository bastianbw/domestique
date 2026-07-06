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
    const perStage: HorizonValue['perStage'] = [];
    projByStage.forEach((entry, i) => {
      const p = entry.projs.find((x) => x.riderId === r.id);
      const xG = p?.xG ?? 0;
      const discount = Math.pow(cfg.horizonDiscount, i);
      value += xG * discount;
      perStage.push({ stage: entry.stage, xG });
    });
    // Key stages = those whose xG is in the upper part of this rider's range.
    const maxX = Math.max(0, ...perStage.map((s) => s.xG));
    const keyStages = perStage
      .filter((s) => s.xG > 0.6 * maxX && s.xG > 0)
      .map((s) => s.stage);
    out[r.id] = { riderId: r.id, value, perStage, keyStages };
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
function wholeRaceGcValue(
  riders: Rider[],
  farStages: Stage[],
  fromStage: number,
  cfg: EngineConfig,
): Record<string, number> {
  const relevant = farStages.filter((s) => GC_RELEVANT_TYPES.has(s.type));
  const out: Record<string, number> = {};
  const gcDiscount = Math.sqrt(cfg.horizonDiscount); // decays slower than the per-stage discount
  for (const s of relevant) {
    const projs = projectField(riders, s, cfg);
    const discount = Math.pow(gcDiscount, s.stage - fromStage);
    for (const p of projs) {
      out[p.riderId] = (out[p.riderId] ?? 0) + discount * p.breakdown.gc;
    }
  }
  return out;
}

/**
 * Forward-looking selection value per rider for the optimizer: the discounted
 * sum of projected xG from `fromStage` to the next rest day (auto depth — no
 * user knob), PLUS a gently-discounted whole-race GC value for the mountain/
 * ITT stages beyond that block (see wholeRaceGcValue). Feed the result into
 * OptimizerInput.forwardValueById so the squad is chosen for the rest of the
 * current block AND a proven GC favourite's season-long value, not just today.
 */
export function forwardValues(
  riders: Rider[],
  allStages: Stage[],
  fromStage: number,
  cfg: EngineConfig = defaultConfig(),
): { values: Record<string, number>; hv: Record<string, HorizonValue>; depth: number; stages: number[] } {
  const upcoming = allStages.filter((s) => s.stage >= fromStage);
  const depth = autoHorizonDepth(fromStage);
  const hv = horizonValues(riders, upcoming, cfg, depth);
  const nearTermEnd = fromStage + depth; // first stage NOT already covered by hv
  const farGc = wholeRaceGcValue(riders, allStages.filter((s) => s.stage >= nearTermEnd), fromStage, cfg);
  const values: Record<string, number> = {};
  for (const id of Object.keys(hv)) values[id] = hv[id].value + (farGc[id] ?? 0);
  return { values, hv, depth, stages: upcoming.slice(0, depth).map((s) => s.stage) };
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
