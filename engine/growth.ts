// ── Expected growth (xG) per rider (§4) ──────────────────────────────────────
// Takes each rider's finishing distribution and computes the expectation over
// the exact §1 growth rules: placement table, sprint/mountain points, jersey
// bonuses, GC bonus, Holdbonus, late-arrival penalty, DNF risk, and the TTT
// special case. Etapebonus and captain bonus are TEAM-level (optimizer).

import type {
  Rider,
  Stage,
  RiderDistribution,
  RiderProjection,
  GrowthBreakdown,
} from './types';
import { EngineConfig, defaultConfig } from './config';
import {
  placementGrowth,
  gcGrowth,
  pointsGrowth,
  lateArrival,
  holdbonus,
  tttGrowth,
  JERSEY_PAYOUT,
  DNF_PENALTY,
} from './rules';
import { buildField, calibrateDistribution } from './probability';
import { simulateStage, buildEnsembleField, DEFAULT_ENSEMBLE_W, DEFAULT_SIM, type SimConfig } from './simulate';

/** P(top-K) from a distribution (positions 1..K). */
export function pTopK(dist: RiderDistribution, k: number): number {
  let p = 0;
  for (let i = 0; i < k && i < dist.probs.length; i++) p += dist.probs[i];
  return p;
}

/** Expected placement growth = Σ P(pos) × placementTable(pos). */
export function expectedPlacement(dist: RiderDistribution): number {
  let e = 0;
  // Only the first 15 positions pay.
  for (let i = 0; i < 15 && i < dist.probs.length; i++) {
    e += dist.probs[i] * placementGrowth(i + 1);
  }
  return e;
}

/**
 * Expected sprint+mountain points growth. The rider's expected share of the
 * stage's points-on-offer is scaled by archetype weight and (for breakaway
 * points) breakaway tendency, then multiplied through the 3,000/pt rule.
 */
// Fraction of the points-on-offer a fully-suited contender is expected to take
// (green points are lucrative under Holdet's 3,000/pt rule, so this is sizable).
export const SPRINT_SHARE = 0.3;
export const MTN_SHARE = 0.28;

export function expectedPoints(
  rider: Rider,
  stage: Stage,
  contendShare: number,
  cfg: EngineConfig,
): number {
  const sprintW = cfg.sprintPointWeight[rider.archetype];
  const mtnW = cfg.mtnPointWeight[rider.archetype];
  const breakBoost = 1 + (rider.breakawayTendency / 100) * 0.5;

  // Expected points = share of contention × archetype weight × points on offer.
  // sprintPtsOnOffer already bundles finish + intermediate-sprint green points.
  const expSprint = contendShare * sprintW * breakBoost * stage.sprintPtsOnOffer * SPRINT_SHARE;
  const expMtn = contendShare * mtnW * breakBoost * stage.mtnPtsOnOffer * MTN_SHARE;
  return pointsGrowth(expSprint, expMtn);
}

/** Expected jersey growth = Σ payout for jerseys the rider currently holds. */
export function expectedJerseys(rider: Rider): number {
  if (!rider.jerseys?.length) return 0;
  return rider.jerseys.reduce((acc, j) => acc + JERSEY_PAYOUT[j], 0);
}

/** Expected late-arrival penalty: only meaningful for non-climbers on hard days. */
export function expectedLateArrival(
  rider: Rider,
  stage: Stage,
  dist: RiderDistribution,
): number {
  const hard = stage.type === 'summit' || stage.type === 'high_mtn';
  if (!hard) return 0;
  const isClimberish = rider.archetype === 'climber' || rider.archetype === 'gc';
  if (isClimberish) return 0;
  // Expected minutes lost grows with how far back they finish; approximate with
  // P(not top 15) × a typical gap that scales with stage hardness.
  const pBack = 1 - pTopK(dist, 15) - dist.pDNF;
  const typicalGapSeconds =
    stage.type === 'high_mtn' ? 8 * 60 : 6 * 60; // rough expected dropout gap
  return Math.max(0, pBack) * lateArrival(typicalGapSeconds);
}

/**
 * Expected Holdbonus: paid to all riders on a team that places top-3 on the
 * stage. We approximate the team's chance of a podium-team result from the
 * rider's own win/podium contention plus team strength, then take the
 * expectation over the 60k/30k/20k ladder. NOT paid on DNF.
 */
export function expectedHoldbonus(
  rider: Rider,
  dist: RiderDistribution,
): number {
  const pWin = dist.probs[0] ?? 0;
  const pP2 = dist.probs[1] ?? 0;
  const pP3 = dist.probs[2] ?? 0;
  // Team-of-winner expectation, lightly boosted by team strength as proxy for
  // a teammate filling the spot.
  const teamFactor = 1 + (rider.teamStrength / 100) * 0.4;
  return (
    holdbonus(1) * pWin * teamFactor +
    holdbonus(2) * pP2 * teamFactor +
    holdbonus(3) * pP3 * teamFactor
  );
}

/** TTT special case: expected Holdtidskørsel growth from team strength. */
export function expectedTTT(rider: Rider, cfg: EngineConfig): number {
  // Map team strength (0..100) to an expected placement payout. Strong teams
  // are likely top-5; weak teams earn nothing. Smooth interpolation.
  const s = rider.teamStrength / 100;
  // Expected payout curve fitted to the ladder (200k..0).
  const e =
    tttGrowth(1) * Math.max(0, s - 0.8) * 5 + // top tier
    tttGrowth(3) * Math.max(0, Math.min(1, s) - 0.55) * 2.2 +
    tttGrowth(5) * Math.max(0, Math.min(1, s) - 0.4) * 1.5;
  return Math.min(tttGrowth(1), Math.max(0, e));
}

export function projectRider(
  rider: Rider,
  stage: Stage,
  dist: RiderDistribution,
  cfg: EngineConfig = defaultConfig(),
): RiderProjection {
  const isTTT = stage.type === 'ttt';

  let placement = 0;
  let sprintMtn = 0;
  let gc = 0;
  let jerseys = expectedJerseys(rider);
  let hold = 0;
  let late = 0;
  let ttt = 0;

  if (isTTT) {
    // TTT REPLACES Etapeplacering, Holdbonus, Sen ankomst, Etapebonus.
    ttt = expectedTTT(rider, cfg);
    gc = gcGrowth(rider.gcPosition); // GC bonus still applies
  } else {
    placement = expectedPlacement(dist);
    const contendShare = pTopK(dist, 15);
    sprintMtn = expectedPoints(rider, stage, contendShare, cfg);
    gc = gcGrowth(rider.gcPosition);
    hold = expectedHoldbonus(rider, dist);
    late = expectedLateArrival(rider, stage, dist);
  }

  const dnfRisk = dist.pDNF * DNF_PENALTY;

  const breakdown: GrowthBreakdown = {
    placement,
    sprintMtn,
    gc,
    jerseys,
    holdbonus: hold,
    lateArrival: late,
    dnfRisk,
    ttt,
  };

  const xG =
    placement + sprintMtn + gc + jerseys + hold + late + dnfRisk + ttt;

  // captainEV: positive growth counted twice (the captain bonus only adds the
  // positive part again). So captainEV = xG + max(0, xG).
  const captainEV = xG + Math.max(0, xG);

  return {
    riderId: rider.id,
    xG,
    pWin: dist.probs[0] ?? 0,
    pTop5: pTopK(dist, 5),
    pTop15: pTopK(dist, 15),
    captainEV,
    breakdown,
  };
}

/** True if any starter carries a usable betting market FOR THIS STAGE (the strongest signal). */
export function fieldHasOdds(riders: Rider[], stageNo: number): boolean {
  return riders.some((r) => {
    if (r.injury === 'out') return false;
    const o = r.oddsByStage?.[stageNo];
    return !!o && ((o.win ?? 0) > 1 || (o.top3 ?? 0) > 1 || (o.top5 ?? 0) > 1 || (o.top10 ?? 0) > 1);
  });
}

/**
 * Convenience: project the whole field for a stage in one call.
 *
 * DEFAULT is ODDS-AWARE:
 *  - If the field carries pasted betting odds → `buildField`, which anchors the
 *    distribution to the (Shin-de-vigged) market. Odds are the strongest signal
 *    in the system, so when present they MUST drive xG — the ensemble below is
 *    blind to odds (it blends the no-odds structural model with the no-odds sim),
 *    so using it when odds exist would silently throw the market away.
 *  - Otherwise → the analytic+sim ENSEMBLE (convex blend, 50/50). The held-out
 *    backtest (docs §4g) — run on a corpus with NO odds — made this the one robust
 *    model win: top-15 Brier 0.0902 → 0.0845 (~6%), the calibration that drives
 *    Etapebonus. Deterministic (seeded sim), so the UI is stable across renders.
 *
 * Every weather/news modifier feeds both paths (riderSkill/effectiveSpread/
 * riderDnfRisk/breakSkill), so the displayed xG always reflects odds + structural
 * model + sim + weather/news, recomputed whenever riders/stage/config change.
 *
 * Escape hatches via `opts` (override the odds-aware default):
 *  - `analytic: true` → pure analytic `buildField` (odds-aware, no sim blend).
 *  - `simulate` → full Monte Carlo only (best break upside, looser top-5).
 *  - `ensemble: { w, sim }` → force the analytic+sim blend (no-odds structural).
 *
 * (Joint-sample Etapebonus was measured and is only ~0.7% better than the
 * Poisson-binomial used in the optimizer — Holdet's ≤2-per-team rule decorrelates
 * the roster — so the joint path is deliberately NOT wired in.)
 */
export function projectField(
  riders: Rider[],
  stage: Stage,
  cfg: EngineConfig = defaultConfig(),
  opts?: { simulate?: SimConfig; ensemble?: { w?: number; sim?: SimConfig }; analytic?: boolean },
): RiderProjection[] {
  const dists = opts?.analytic
    ? buildField(riders, stage, cfg)
    : opts?.simulate
      ? simulateStage(riders, stage, cfg, opts.simulate)
      : opts?.ensemble
        ? buildEnsembleField(riders, stage, cfg, opts.ensemble.w, opts.ensemble.sim)
        // Odds-aware default: market when THIS STAGE has odds, else the ensemble.
        : fieldHasOdds(riders, stage.stage)
          ? buildField(riders, stage, cfg)
          : buildEnsembleField(riders, stage, cfg, DEFAULT_ENSEMBLE_W, DEFAULT_SIM);
  // Post-hoc probability calibration (γ=1 → identity).
  const cal = dists.map((d) => calibrateDistribution(d, cfg.calibrationGamma));
  const byId = new Map(cal.map((d) => [d.riderId, d]));
  return riders.map((r) => projectRider(r, stage, byId.get(r.id)!, cfg));
}
