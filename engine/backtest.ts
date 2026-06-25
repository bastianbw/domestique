// ── Backtest / calibration harness (§2, upgrade) ─────────────────────────────
// Pure scoring of finishing-position distributions against realised results.
// No fs/DOM: scripts/run_backtest.ts loads the corpus, builds rosters via
// features.ts, calls buildField, and feeds (distributions, actual order) here.
//
// Metrics (per the design doc):
//   - mean negative log-likelihood (NLL) of each finisher's realised position
//     under its own marginal distribution — the PRIMARY accuracy number;
//   - Brier scores for the binary events pWin / pTop5 / pTop15;
//   - a reliability table (predicted pTop5 bucket vs empirical hit rate);
//   - placement-growth MAE (predicted E[placement growth] vs realised, in DKK).
// Baselines (uniform, pcsRank-only) live in scripts/run_backtest.ts via the same
// scoring entry points so every model change is gated on beating them.
//
// See docs/PREDICTION_MODEL_UPGRADE.md §2.

import type { RiderDistribution } from './types';
import { placementGrowth } from './rules';

const EPS = 1e-6;

export interface ActualFinish {
  riderId: string;
  /** finishing position (1-based); null/undefined = DNF / not classified. */
  rank?: number | null;
}

export interface StageScore {
  /** mean −log P(actual position) over classified finishers (lower = better) */
  nll: number;
  brierWin: number;
  brierTop5: number;
  brierTop15: number;
  /** mean |predicted placement-growth − realised|, DKK */
  placementGrowthMAE: number;
  /** number of classified finishers scored */
  n: number;
}

function pTopK(probs: number[], k: number): number {
  let p = 0;
  for (let i = 0; i < k && i < probs.length; i++) p += probs[i];
  return p;
}

function expectedPlacementGrowth(probs: number[]): number {
  let e = 0;
  for (let i = 0; i < 15 && i < probs.length; i++) e += probs[i] * placementGrowth(i + 1);
  return e;
}

/**
 * Score one stage. `distById` maps riderId → finishing distribution (probs sum
 * to ≤ 1; the deficit is DNF mass). `actuals` are the realised finishes.
 * Only classified finishers (rank ≥ 1) contribute to NLL and growth MAE; the
 * binary Brier events are scored over all riders that have a distribution.
 */
export function scoreStage(
  distById: Map<string, number[]>,
  actuals: ActualFinish[],
): StageScore {
  let nllSum = 0;
  let nllN = 0;
  let bWin = 0;
  let bTop5 = 0;
  let bTop15 = 0;
  let bN = 0;
  let maeSum = 0;
  let maeN = 0;

  const rankById = new Map<string, number>();
  for (const a of actuals) {
    if (a.rank != null && a.rank >= 1) rankById.set(a.riderId, a.rank);
  }

  for (const [id, probs] of distById) {
    if (!probs || probs.length === 0) continue;
    const rank = rankById.get(id);
    const isWin = rank === 1 ? 1 : 0;
    const isTop5 = rank != null && rank <= 5 ? 1 : 0;
    const isTop15 = rank != null && rank <= 15 ? 1 : 0;

    bWin += (pTopK(probs, 1) - isWin) ** 2;
    bTop5 += (pTopK(probs, 5) - isTop5) ** 2;
    bTop15 += (pTopK(probs, 15) - isTop15) ** 2;
    bN++;

    if (rank != null && rank >= 1) {
      const p = probs[rank - 1] ?? 0;
      nllSum += -Math.log(Math.max(EPS, p));
      nllN++;
      const realised = placementGrowth(rank);
      maeSum += Math.abs(expectedPlacementGrowth(probs) - realised);
      maeN++;
    }
  }

  return {
    nll: nllN ? nllSum / nllN : 0,
    brierWin: bN ? bWin / bN : 0,
    brierTop5: bN ? bTop5 / bN : 0,
    brierTop15: bN ? bTop15 / bN : 0,
    placementGrowthMAE: maeN ? maeSum / maeN : 0,
    n: nllN,
  };
}

/** Aggregate per-stage scores into a corpus-level summary (count-weighted). */
export function aggregateScores(scores: StageScore[]): StageScore & { stages: number } {
  let nll = 0;
  let bWin = 0;
  let bTop5 = 0;
  let bTop15 = 0;
  let mae = 0;
  let n = 0;
  for (const s of scores) {
    nll += s.nll * s.n;
    bWin += s.brierWin * s.n;
    bTop5 += s.brierTop5 * s.n;
    bTop15 += s.brierTop15 * s.n;
    mae += s.placementGrowthMAE * s.n;
    n += s.n;
  }
  const d = Math.max(1, n);
  return {
    stages: scores.length,
    nll: nll / d,
    brierWin: bWin / d,
    brierTop5: bTop5 / d,
    brierTop15: bTop15 / d,
    placementGrowthMAE: mae / d,
    n,
  };
}

// ── Reliability (calibration) table ──────────────────────────────────────────

export interface ReliabilityBucket {
  lo: number;
  hi: number;
  predictedMean: number;
  empiricalRate: number;
  count: number;
}

/**
 * Bucket predicted pTop5 into deciles and compare to the empirical top-5 rate.
 * A well-calibrated model has predictedMean ≈ empiricalRate in every bucket.
 */
export function reliabilityTop5(
  samples: Array<{ pTop5: number; actualTop5: boolean }>,
  buckets = 10,
): ReliabilityBucket[] {
  const out: ReliabilityBucket[] = [];
  for (let b = 0; b < buckets; b++) {
    const lo = b / buckets;
    const hi = (b + 1) / buckets;
    const inB = samples.filter((s) => s.pTop5 >= lo && (b === buckets - 1 ? s.pTop5 <= hi : s.pTop5 < hi));
    const count = inB.length;
    out.push({
      lo,
      hi,
      predictedMean: count ? inB.reduce((a, s) => a + s.pTop5, 0) / count : 0,
      empiricalRate: count ? inB.filter((s) => s.actualTop5).length / count : 0,
      count,
    });
  }
  return out;
}

// ── Baseline distributions (the bar every model change must clear) ────────────

/**
 * Precision@k: of the k riders a model rates highest for the stage, the fraction
 * that actually finish in the top-k. This is the discrimination metric that
 * matters for team selection — unlike exact-position NLL it is not fooled by a
 * flat predictor (uniform scores ≈ random = k/fieldSize). `rankedIds` are the
 * field ordered best→worst by the model's head probability.
 */
export function precisionAtK(rankedIds: string[], actualTopK: Set<string>, k: number): number {
  const top = rankedIds.slice(0, k);
  if (top.length === 0) return 0;
  let hit = 0;
  for (const id of top) if (actualTopK.has(id)) hit++;
  return hit / top.length;
}

/** Uniform over a field of `n` finishing slots. */
export function uniformDist(n: number): number[] {
  return new Array(n).fill(1 / n);
}

/**
 * Rank-only geometric baseline: order riders by ascending pcsRank, give the
 * front of the grid a geometric finishing curve. Captures "better-ranked riders
 * finish higher" with no archetype/route/form knowledge.
 */
export function rankOnlyDist(sortedRankPos: number, n: number, r = 0.06): number[] {
  // sortedRankPos: 0-based index of this rider in the field sorted best→worst.
  // Shift a geometric curve so this rider's modal finish ≈ their rank position.
  const probs = new Array<number>(n).fill(0);
  let sum = 0;
  for (let k = 0; k < n; k++) {
    const d = Math.abs(k - sortedRankPos);
    const p = Math.pow(1 - r, d);
    probs[k] = p;
    sum += p;
  }
  for (let k = 0; k < n; k++) probs[k] /= sum;
  return probs;
}
