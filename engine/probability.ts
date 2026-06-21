// ── Finishing-position probability model (§4) ────────────────────────────────
// For each rider on a stage, produce a finishing-position probability
// distribution. Betting odds (de-vigged) anchor the head when present; the
// stage-profile × archetype matrix plus form/PCS/team-strength shape the rest.

import type {
  Rider,
  Stage,
  RiderDistribution,
  RiderOdds,
  Archetype,
} from './types';
import { EngineConfig, defaultConfig } from './config';

/** Convert a single decimal odd to an implied probability. */
export function impliedProb(decimalOdd?: number): number | undefined {
  if (!decimalOdd || decimalOdd <= 1) return undefined;
  return 1 / decimalOdd;
}

/**
 * De-vig a set of WIN odds across the field by normalising implied
 * probabilities so they sum to 1 (proportional / "basic" method).
 */
export function devigWinOdds(winOdds: Array<number | undefined>): number[] {
  const implied = winOdds.map((o) => impliedProb(o) ?? 0);
  const overround = implied.reduce((a, b) => a + b, 0);
  if (overround <= 0) return winOdds.map(() => 0);
  return implied.map((p) => p / overround);
}

/** Contention strength of a rider on a stage from the non-odds signals (0..~1). */
export function contentionStrength(
  rider: Rider,
  stage: Stage,
  cfg: EngineConfig = defaultConfig(),
): number {
  if (rider.injury === 'out') return 0;

  const suit = cfg.suitability[stage.type][rider.archetype];

  // form: 0..100 → 0..1
  const formScore = clamp01(rider.form / 100);
  // pcsRank: 1 (best) → ~1.0, decays with rank
  const rankScore = 1 / (1 + Math.log10(Math.max(1, rider.pcsRank)));
  // team strength: 0..100 → 0..1, dominant for TTT
  const teamScore = clamp01(rider.teamStrength / 100);

  const w = cfg.signalWeights;
  let strength =
    w.suitability * suit +
    w.form * formScore +
    w.pcsRank * rankScore +
    w.teamStrength * teamScore;

  // On a TTT, team strength dominates the result entirely.
  if (stage.type === 'ttt') {
    strength = 0.25 * strength + 0.75 * teamScore;
  }

  if (rider.injury === 'doubt') strength *= cfg.doubtDampen;

  return Math.max(0, strength);
}

/**
 * Build a full finishing-position distribution for one rider.
 *
 * Approach: derive a single "strength" scalar that blends de-vigged win
 * probability (when odds present) with the contention strength, then spread it
 * into a position distribution using a geometric decay whose sharpness scales
 * with strength (stronger riders concentrate near the front). Finally fold in
 * a per-rider DNF probability.
 */
export function buildDistribution(
  rider: Rider,
  stage: Stage,
  fieldStrength: number,
  cfg: EngineConfig = defaultConfig(),
  devigWin?: number,
): RiderDistribution {
  const N = cfg.fieldSize;

  if (rider.injury === 'out') {
    return { riderId: rider.id, probs: new Array(N).fill(0), pDNF: 0 };
  }

  const raw = contentionStrength(rider, stage, cfg);
  // Normalise against the field so probabilities are comparable across riders.
  const rel = fieldStrength > 0 ? raw / fieldStrength : 0;

  // Blend with de-vigged win prob (the strongest head anchor when present).
  let headStrength = rel;
  if (devigWin !== undefined) {
    headStrength = cfg.oddsAnchorWeight * devigWin + (1 - cfg.oddsAnchorWeight) * rel;
  }

  const pDNF = riderDnfRisk(rider, stage, cfg);

  // Geometric decay: P(pos k) ∝ (1-r)^(k-1), with r increasing in strength so
  // stronger riders pile probability onto the front positions.
  const r = clamp(0.02 + headStrength * 0.5, 0.02, 0.85);
  const probs = new Array<number>(N).fill(0);
  let sum = 0;
  for (let k = 0; k < N; k++) {
    const p = Math.pow(1 - r, k) * r;
    probs[k] = p;
    sum += p;
  }
  // Normalise the finishing mass to (1 - pDNF).
  const finishMass = 1 - pDNF;
  for (let k = 0; k < N; k++) probs[k] = (probs[k] / sum) * finishMass;

  return { riderId: rider.id, probs, pDNF };
}

export function riderDnfRisk(
  rider: Rider,
  stage: Stage,
  cfg: EngineConfig = defaultConfig(),
): number {
  let risk = cfg.baseDnfRisk[rider.archetype];
  // Hard mountain stages raise abandonment risk for non-climbers a touch.
  if ((stage.type === 'summit' || stage.type === 'high_mtn') &&
      rider.archetype !== 'climber' && rider.archetype !== 'gc') {
    risk *= 1.5;
  }
  if (rider.injury === 'doubt') risk *= 2;
  return clamp(risk, 0, 0.5);
}

/**
 * Build distributions for the whole field at once, handling odds de-vigging
 * across the field and the shared field-strength normaliser.
 */
export function buildField(
  riders: Rider[],
  stage: Stage,
  cfg: EngineConfig = defaultConfig(),
): RiderDistribution[] {
  const starters = riders.filter((r) => r.injury !== 'out');

  // Field strength normaliser = sum of contention strengths.
  const fieldStrength = starters.reduce(
    (acc, r) => acc + contentionStrength(r, stage, cfg),
    0,
  );

  // De-vig win odds across riders that supplied them.
  const haveOdds = starters.some((r) => r.odds?.win);
  let devigByIndex: Record<string, number> = {};
  if (haveOdds) {
    const ids = starters.map((r) => r.id);
    const wins = starters.map((r) => r.odds?.win);
    const devigged = devigWinOdds(wins);
    ids.forEach((id, i) => (devigByIndex[id] = devigged[i]));
  }

  return riders.map((r) => {
    if (r.injury === 'out') {
      return { riderId: r.id, probs: new Array(cfg.fieldSize).fill(0), pDNF: 0 };
    }
    const dw = haveOdds && r.odds?.win ? devigByIndex[r.id] : undefined;
    return buildDistribution(r, stage, fieldStrength, cfg, dw);
  });
}

// helpers
function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
function clamp01(x: number): number {
  return clamp(x, 0, 1);
}

export type { RiderOdds, Archetype };
