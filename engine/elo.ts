// ── Dynamic rider ratings (Elo) ──────────────────────────────────────────────
// A self-updating strength rating: after every race the riders who beat the field
// gain points and those beaten lose them, so the signal tracks current ability +
// form far more responsively than a static season rank. Pure functions; the
// backtest runs them chronologically and the live app updates from each result.

export const ELO_BASE = 1500;
export const ELO_K = 24;
const ELO_SCALE = 400;

/** Expected score of A vs B (0..1) — the logistic Elo formula. */
export function eloExpected(rA: number, rB: number): number {
  return 1 / (1 + Math.pow(10, (rB - rA) / ELO_SCALE));
}

/** Seed a rating from a PCS season rank (rank 1 ≈ 1900, ~1500 by rank 250+). */
export function priorRating(pcsRank: number): number {
  return ELO_BASE + ELO_SCALE * Math.exp(-(Math.max(1, pcsRank) - 1) / 60);
}

/**
 * Inverse of priorRating: map a rating back to a PCS-rank-like number so the
 * existing strength curve (strengthFromRank) can consume it unchanged. A strong
 * rider gets a low rank in ANY field (absolute, not within-field).
 */
export function ratingToRank(rating: number): number {
  if (rating <= ELO_BASE + 1e-6) return 300; // at/below baseline → journeyman
  const rank = 1 - 60 * Math.log((rating - ELO_BASE) / ELO_SCALE);
  return Math.max(1, Math.min(900, rank));
}

/**
 * Update ratings in place after one stage, given the finishing order (best→worst
 * rider ids). Generalised multiplayer Elo: a rider's actual score is the fraction
 * of the field they beat; expected score is the mean pairwise logistic vs the
 * rest. `k` scales the step (raise for more important races).
 */
export function updateStage(ratings: Map<string, number>, order: string[], k = ELO_K): void {
  const M = order.length;
  if (M < 2) return;
  const R = order.map((id) => ratings.get(id) ?? ELO_BASE);
  const delta = new Array<number>(M).fill(0);
  for (let i = 0; i < M; i++) {
    const actual = (M - 1 - i) / (M - 1); // 1 for winner, 0 for last
    let expected = 0;
    for (let j = 0; j < M; j++) if (j !== i) expected += eloExpected(R[i], R[j]);
    expected /= M - 1;
    delta[i] = k * (actual - expected);
  }
  order.forEach((id, i) => ratings.set(id, R[i] + delta[i]));
}
