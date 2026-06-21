// ── Exact Holdet Tourspillet 2026 growth rules (authoritative, §1) ───────────
// Every value here is taken verbatim from the brief. These are the ground truth
// the prediction model takes expectations over and the result logger applies.

import type { JerseyKey } from './types';

/** Etapeplacering — stage finish position → DKK (16th+ = 0). */
export const PLACEMENT_TABLE: Record<number, number> = {
  1: 200_000,
  2: 150_000,
  3: 130_000,
  4: 120_000,
  5: 110_000,
  6: 100_000,
  7: 95_000,
  8: 90_000,
  9: 85_000,
  10: 80_000,
  11: 70_000,
  12: 55_000,
  13: 40_000,
  14: 30_000,
  15: 15_000,
};

export function placementGrowth(pos: number): number {
  return PLACEMENT_TABLE[pos] ?? 0;
}

/** Sammenlagt — GC position after the stage → DKK (11+ = 0). */
export const GC_TABLE: Record<number, number> = {
  1: 100_000,
  2: 90_000,
  3: 80_000,
  4: 70_000,
  5: 60_000,
  6: 50_000,
  7: 40_000,
  8: 30_000,
  9: 20_000,
  10: 10_000,
};

export function gcGrowth(pos: number | undefined): number {
  if (!pos) return 0;
  return GC_TABLE[pos] ?? 0;
}

/**
 * Etapebonus — based on how many of YOUR 8 riders finish in the stage top-15.
 * Paid ONCE to your bank, NOT per rider.
 */
export const ETAPEBONUS_TABLE: Record<number, number> = {
  1: 4_000,
  2: 8_000,
  3: 15_000,
  4: 35_000,
  5: 65_000,
  6: 120_000,
  7: 220_000,
  8: 400_000,
};

export function etapebonus(ridersInTop15: number): number {
  if (ridersInTop15 <= 0) return 0;
  const capped = Math.min(8, Math.floor(ridersInTop15));
  return ETAPEBONUS_TABLE[capped] ?? 0;
}

/** Holdtidskørsel (TTT) placement — paid to ALL active riders on placing teams. */
export const TTT_TABLE: Record<number, number> = {
  1: 200_000,
  2: 150_000,
  3: 100_000,
  4: 50_000,
  5: 25_000,
};

export function tttGrowth(teamPlacing: number): number {
  return TTT_TABLE[teamPlacing] ?? 0;
}

/** Holdbonus — rider's TEAM result on the stage, paid to all that team's riders. */
export const HOLDBONUS_TABLE: Record<number, number> = {
  1: 60_000,
  2: 30_000,
  3: 20_000,
};

export function holdbonus(teamStagePlacing: number): number {
  return HOLDBONUS_TABLE[teamStagePlacing] ?? 0;
}

/** Jersey daily payouts — paid to the wearer that day. */
export const JERSEY_PAYOUT: Record<JerseyKey, number> = {
  yellow: 25_000,
  green: 25_000,
  polka: 25_000,
  white: 15_000,
  aggressive: 50_000,
};

/** 3,000 kr per sprint point AND per mountain point (negative allowed). */
export const POINT_VALUE = 3_000;

export function pointsGrowth(sprintPts: number, mtnPts: number): number {
  return (sprintPts + mtnPts) * POINT_VALUE;
}

/** Sen ankomst — −3,000 per FULL minute behind the winner, capped at −90,000. */
export const LATE_PER_MINUTE = -3_000;
export const LATE_CAP = -90_000;

export function lateArrival(gapSeconds: number): number {
  if (!gapSeconds || gapSeconds <= 0) return 0;
  const fullMinutes = Math.floor(gapSeconds / 60);
  if (fullMinutes === 0) return 0;
  return Math.max(LATE_CAP, fullMinutes * LATE_PER_MINUTE);
}

/** DNF (did not finish the stage): −50,000 that stage. */
export const DNF_PENALTY = -50_000;
/** DNS (did not start / abandoned): −100,000 for EACH remaining stage. */
export const DNS_PER_STAGE = -100_000;

/**
 * A rider who abandons ON stage N takes the DNF penalty for stage N, then
 * −100,000 for every stage from N+1..21. This returns the TOTAL DNS penalty
 * charged across the remaining (not-started) stages from `fromStage`..`lastStage`.
 */
export function dnsTotalPenalty(fromStage: number, lastStage = 21): number {
  const remaining = Math.max(0, lastStage - fromStage + 1);
  if (remaining === 0) return 0;
  return remaining * DNS_PER_STAGE;
}

/** Bank interest — +0.5% per round on bank balance. */
export const INTEREST_RATE = 0.005;
export function applyInterest(bank: number): number {
  // Holdet values are whole kroner; round to avoid float drift compounding.
  return Math.round(bank * (1 + INTEREST_RATE));
}

/** Transfer fee — 1% of the bought rider's value, from stage 1 onward. */
export const TRANSFER_FEE_RATE = 0.01;
export function transferFee(riderValue: number): number {
  return riderValue * TRANSFER_FEE_RATE;
}

/** Kaptajnbonus — captain's POSITIVE round growth is paid again. */
export function captainBonus(captainPositiveGrowth: number): number {
  return Math.max(0, captainPositiveGrowth);
}
