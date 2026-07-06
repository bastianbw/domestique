// ── Tunable model configuration (single CONFIG, §4) ──────────────────────────
// Every knob the prediction model uses lives here so it can be inspected on the
// "How it works" page and nudged by the calibration loop. No magic numbers
// scattered through the model.

import type { Archetype, StageType, RiskPreset } from './types';

/**
 * Stage-profile × archetype suitability matrix.
 * Higher = better suited to contend for the stage win on that profile.
 * Values are relative strengths (0..1-ish) that shape the head of the
 * finishing distribution. The calibration loop nudges these toward reality.
 */
export type SuitabilityMatrix = Record<StageType, Record<Archetype, number>>;

export const DEFAULT_SUITABILITY: SuitabilityMatrix = {
  flat: {
    sprinter: 1.0, puncheur: 0.45, climber: 0.15, gc: 0.35,
    rouleur: 0.55, breakaway: 0.4, domestique: 0.15,
  },
  hilly: {
    sprinter: 0.4, puncheur: 1.0, climber: 0.6, gc: 0.7,
    rouleur: 0.55, breakaway: 0.75, domestique: 0.2,
  },
  summit: {
    sprinter: 0.05, puncheur: 0.45, climber: 1.0, gc: 0.95,
    rouleur: 0.2, breakaway: 0.55, domestique: 0.15,
  },
  high_mtn: {
    sprinter: 0.05, puncheur: 0.4, climber: 1.0, gc: 0.9,
    rouleur: 0.25, breakaway: 0.7, domestique: 0.15,
  },
  ttt: {
    // On a TTT individual archetype matters little; team strength dominates.
    sprinter: 0.5, puncheur: 0.5, climber: 0.5, gc: 0.5,
    rouleur: 0.5, breakaway: 0.5, domestique: 0.5,
  },
  hilly_itt: {
    sprinter: 0.3, puncheur: 0.65, climber: 0.55, gc: 0.85,
    rouleur: 1.0, breakaway: 0.2, domestique: 0.25,
  },
};

/**
 * Sprint/mountain point earning weights by archetype. Multiplies the share of
 * the stage's points-on-offer the rider is expected to take.
 */
export const SPRINT_POINT_WEIGHT: Record<Archetype, number> = {
  sprinter: 1.0, puncheur: 0.5, climber: 0.1, gc: 0.25,
  rouleur: 0.3, breakaway: 0.55, domestique: 0.1,
};

export const MTN_POINT_WEIGHT: Record<Archetype, number> = {
  sprinter: 0.05, puncheur: 0.35, climber: 1.0, gc: 0.6,
  rouleur: 0.15, breakaway: 0.8, domestique: 0.1,
};

/** How much betting odds (when present) anchor the head of the distribution. */
export const ODDS_ANCHOR_WEIGHT = 0.7;

/**
 * Start-list fraction at which a betting market is treated as "complete" enough
 * to fully trust. Below this, the odds-anchored distribution is blended toward
 * the structural model in proportion to coverage — so a lone favourite (or a
 * 2-3 rider market) doesn't read as a near-certainty across Win/Top5/Top15, and
 * unpriced riders don't collapse onto a flat fallback. A normally-priced field
 * (≥ this fraction) is unaffected; odds remain the dominant signal.
 */
export const ODDS_COVERAGE_REF = 0.35;

/** Form / PCS rank / team-strength blend for shaping the non-odds curve. */
export const SIGNAL_WEIGHTS = {
  suitability: 0.45,
  form: 0.2,
  pcsRank: 0.2,
  teamStrength: 0.15,
};

/** Injury "doubt" dampening factor applied to a rider's contention strength. */
export const DOUBT_DAMPEN = 0.5;

/** Per-stage DNF base risk by archetype (used for expected −50k penalty). */
export const BASE_DNF_RISK: Record<Archetype, number> = {
  sprinter: 0.02, puncheur: 0.02, climber: 0.02, gc: 0.015,
  rouleur: 0.02, breakaway: 0.03, domestique: 0.025,
};

/** Field size assumed for the finishing distribution. 2026 Tour: 23 teams × 8. */
export const FIELD_SIZE = 184;

/**
 * Risk presets are a MEAN–VARIANCE reshape of the SAME expected-value objective,
 * so balanced is always the expected-return maximum and the others trade EV for
 * a different risk profile:
 *  - balanced: pure max expected value (no penalty/tilt) → highest expected return.
 *  - safe: EV − varPenalty·σ(team) − churnPenalty·fees → steadier + cheaper, so a
 *    little below balanced on EV but lower variance and fewer transfers.
 *  - aggressive: EV + ceiling tilt (P(win) + breakaway upside) → higher ceiling,
 *    a little below balanced on EV.
 */
export const RISK_TUNING: Record<RiskPreset, {
  varPenalty: number; // DKK penalty per DKK of team stage-growth std-dev (lower = steadier)
  churnPenalty: number; // extra multiple on transfer fees (favours keeping riders)
  winWeight: number; // DKK added per expected stage win (ceiling tilt)
  breakawayWeight: number; // DKK added per unit breakaway tendency (lottery upside)
}> = {
  safe: { varPenalty: 0.45, churnPenalty: 1.5, winWeight: 0, breakawayWeight: 0 },
  balanced: { varPenalty: 0, churnPenalty: 0, winWeight: 0, breakawayWeight: 0 },
  aggressive: { varPenalty: 0, churnPenalty: 0, winWeight: 900_000, breakawayWeight: 220_000 },
};

/** Horizon planning: discount factor per stage into the future. */
export const HORIZON_DISCOUNT = 0.75;
export const DEFAULT_HORIZON_DEPTH = 3;

/**
 * Coherent-joint (no-odds) finishing model (§1b). `jointSpread` is the Gaussian
 * spread (in finishing positions) of the skill-seeded distribution before the
 * Sinkhorn column-normalisation; smaller = sharper/more confident. `skillForm`
 * is the floor of the form multiplier so form modulates but never zeroes skill.
 */
export const JOINT_SPREAD = 16;
export const SKILL_FORM_FLOOR = 0.6;

/**
 * Continuous "climbiness" (vertical-m per km) refines the coarse 6-way stage
 * type: a stage typed `hilly` but with mountain-level climbing should still lift
 * climbers/GC and drop sprinters. `climbinessGain` scales the per-archetype
 * response (0 disables); the matrix below is the response slope at full mountain.
 */
/**
 * Field-strength scaling: a deep, high-quality field (many capable riders) is
 * less predictable, so the coherent model widens its spread; a weak field
 * (one star vs the rest) sharpens it. `fieldQualityRef` ≈ a strong WorldTour
 * start-list-quality score. Calibration lever (precision is spread-invariant).
 */
export const FIELD_QUALITY_REF = 1300;
export const FIELD_SPREAD_RANGE = 0.5; // ± fraction of jointSpread across field strengths

export const CLIMBINESS_GAIN = 1.5;
export const CLIMBINESS_RESPONSE: Record<Archetype, number> = {
  climber: 0.6, gc: 0.5, puncheur: 0.1, breakaway: 0.3,
  sprinter: -0.7, rouleur: -0.3, domestique: -0.2,
};

/**
 * Breakaway-win rate by stage type, calibrated from the 2026 corpus (fraction of
 * stages whose winner spent km in the break). The no-odds model mixes a
 * breakaway-pool field in at this weight so cheap break-prone riders get real
 * top-k / win mass on break-friendly stages instead of ~0. Summit/ITT ≈ 0 (won
 * by GC/climbers from the front).
 */
export const BREAKAWAY_WIN_RATE: Record<StageType, number> = {
  flat: 0.08, hilly: 0.24, high_mtn: 0.10, summit: 0.02, ttt: 0, hilly_itt: 0,
};

/** Differential mode: how strongly to lean away from heavily-owned riders. */
export const OWNERSHIP_LEVERAGE = 0.15;

/**
 * Post-hoc probability calibration: a temperature on each rider's finishing
 * curve (probs ∝ probs^γ, renormalised to the finishing mass). γ<1 flattens an
 * over-confident model; γ>1 sharpens. Fit on held-out data to minimise top-k
 * Brier. 1.0 = identity (no calibration). Fitted to 0.85 on the 2024-26 corpus:
 * the structural model is mildly over-confident in the mid-head (predicts ~15%
 * top-5 for riders who hit ~8%), and γ=0.85 minimises top-5 Brier + placement
 * MAE. γ does NOT change discrimination (P@k), only probability calibration.
 */
export const CALIBRATION_GAMMA = 0.85;

/**
 * Ensemble blend weight on the ANALYTIC coherent model PER stage type (the
 * simulator gets the remaining 1−w). Learned on held-out data: the analytic
 * model has the sharpest head on bunch finishes (flat/ITT), while the simulator
 * captures breakaway upside + top-15 calibration on break-friendly terrain
 * (hilly/mountain) — so the more accurate component weighs more on each profile.
 */
// Fitted on 2023-25 → held-out 2026 (grid-min top-15 Brier): the simulator is
// the more accurate component on almost every profile, so it carries most weight
// (analytic floored at 0.15 to smooth Monte-Carlo noise; flat keeps more analytic
// for sprint-head sharpness; TTT is team-strength driven so the blend barely matters).
export const ENSEMBLE_ANALYTIC_WEIGHT: Record<StageType, number> = {
  flat: 0.3, hilly: 0.15, summit: 0.15, high_mtn: 0.15, ttt: 0.5, hilly_itt: 0.2,
};

/**
 * Per-market logistic stacking weights. The meta-model combines each base
 * signal's predicted P(top-k) (analytic + simulator) plus the rider's rank
 * strength into one CALIBRATED P(top-k) — learned per market, so the signals are
 * weighted by their out-of-sample accuracy rather than a fixed blend.
 */
export interface StackWeights { b0: number; ana: number; sim: number; rank: number }
/** Keyed by market k (1=win, 5=top5, 15=top15). */
export type StackModel = Record<number, StackWeights>;

export interface EngineConfig {
  suitability: SuitabilityMatrix;
  sprintPointWeight: Record<Archetype, number>;
  mtnPointWeight: Record<Archetype, number>;
  oddsAnchorWeight: number;
  oddsCoverageRef: number;
  signalWeights: typeof SIGNAL_WEIGHTS;
  doubtDampen: number;
  baseDnfRisk: Record<Archetype, number>;
  fieldSize: number;
  riskTuning: typeof RISK_TUNING;
  horizonDiscount: number;
  ownershipLeverage: number;
  jointSpread: number;
  skillFormFloor: number;
  fieldQualityRef: number;
  fieldSpreadRange: number;
  climbinessGain: number;
  climbinessResponse: Record<Archetype, number>;
  breakawayWinRate: Record<StageType, number>;
  calibrationGamma: number;
  ensembleAnalyticWeight: Record<StageType, number>;
  /** Optional logistic stacking meta-model (no-odds path). Absent → linear ensemble. */
  stackModel?: StackModel;
}

export function defaultConfig(): EngineConfig {
  // deep-ish clone so calibration mutates a copy, not the module constants
  return {
    suitability: JSON.parse(JSON.stringify(DEFAULT_SUITABILITY)),
    sprintPointWeight: { ...SPRINT_POINT_WEIGHT },
    mtnPointWeight: { ...MTN_POINT_WEIGHT },
    oddsAnchorWeight: ODDS_ANCHOR_WEIGHT,
    oddsCoverageRef: ODDS_COVERAGE_REF,
    signalWeights: { ...SIGNAL_WEIGHTS },
    doubtDampen: DOUBT_DAMPEN,
    baseDnfRisk: { ...BASE_DNF_RISK },
    fieldSize: FIELD_SIZE,
    riskTuning: JSON.parse(JSON.stringify(RISK_TUNING)),
    horizonDiscount: HORIZON_DISCOUNT,
    ownershipLeverage: OWNERSHIP_LEVERAGE,
    jointSpread: JOINT_SPREAD,
    skillFormFloor: SKILL_FORM_FLOOR,
    fieldQualityRef: FIELD_QUALITY_REF,
    fieldSpreadRange: FIELD_SPREAD_RANGE,
    climbinessGain: CLIMBINESS_GAIN,
    climbinessResponse: { ...CLIMBINESS_RESPONSE },
    breakawayWinRate: { ...BREAKAWAY_WIN_RATE },
    calibrationGamma: CALIBRATION_GAMMA,
    ensembleAnalyticWeight: { ...ENSEMBLE_ANALYTIC_WEIGHT },
  };
}
