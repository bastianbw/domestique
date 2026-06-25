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
import { strengthFromRank } from './features';

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

  // Lead-out quality is a real predictive signal for sprinters on flat days:
  // a strong train turns a fast finisher into a stage-win contender.
  if (rider.archetype === 'sprinter' && stage.type === 'flat' && rider.sprintTrainSupport) {
    strength += 0.10 * (rider.sprintTrainSupport / 100);
  }

  // On a TTT, team strength dominates the result entirely.
  if (stage.type === 'ttt') {
    strength = 0.25 * strength + 0.75 * teamScore;
  }

  if (rider.injury === 'doubt') strength *= cfg.doubtDampen;

  return Math.max(0, strength);
}

// ── Odds-ladder distribution ─────────────────────────────────────────────────
// Bookmaker margins per market (place markets carry a wider margin). Used to
// de-vig implied probabilities when field coverage is too sparse to normalise
// to the exact slot count.
const MARKET_MARGIN: Record<number, number> = { 1: 1.12, 3: 1.18, 5: 1.2, 10: 1.25 };

/**
 * De-vig one market across the field. `slots` = how many riders finish inside
 * the market (1 for win, 3 for top-3, …). With full coverage we normalise the
 * implied probabilities to sum to `slots`; with sparse coverage we fall back to
 * a fixed margin so a lone favourite isn't over-inflated.
 */
export function devigMarket(odds: Array<number | undefined>, slots: number): number[] {
  const implied = odds.map((o) => impliedProb(o) ?? 0);
  const S = implied.reduce((a, b) => a + b, 0);
  if (S <= 0) return implied.map(() => 0);
  const divisor = Math.max(S / slots, MARKET_MARGIN[slots] ?? 1.15);
  return implied.map((p) => (p > 0 ? clamp01(p / divisor) : 0));
}

interface Anchor { k: number; q: number; }

/**
 * Build a finishing distribution that HITS the de-vigged odds at each market
 * threshold. P(top-k) at every supplied market equals the de-vigged number, so
 * pWin ≈ the de-vigged win odds and the placement expectation is calibrated to
 * the market rather than to a single hand-tuned decay parameter.
 */
function buildDistributionFromAnchors(
  riderId: string,
  rawAnchors: Anchor[],
  pDNF: number,
  headStrength: number,
  N: number,
): RiderDistribution {
  const finishMass = 1 - pDNF;
  const probs = new Array<number>(N).fill(0);

  // Make cumulative targets monotonic and bounded by the finishing mass.
  const pts = [...rawAnchors].sort((a, b) => a.k - b.k);
  const clamped: Anchor[] = [];
  let prev = 0;
  for (const a of pts) {
    const q = clamp(a.q, prev, finishMass);
    clamped.push({ k: a.k, q });
    prev = q;
  }

  // Tail sharpness: stronger riders pile their remaining mass nearer the front.
  const r = clamp(0.05 + headStrength * 0.3, 0.05, 0.6);

  let lastK = 0;
  let lastQ = 0;
  for (const { k, q } of clamped) {
    distributeFrontHeavy(probs, lastK, k - 1, q - lastQ);
    lastK = k;
    lastQ = q;
  }
  // Remaining mass beyond the last anchor decays geometrically to the back.
  const remaining = finishMass - lastQ;
  if (remaining > 1e-9 && lastK < N) {
    distributeGeometric(probs, lastK, N - 1, remaining, r);
  }

  return { riderId, probs, pDNF };
}

/** Spread `mass` over inclusive index range [i0..i1] with a front-heavy taper. */
function distributeFrontHeavy(probs: number[], i0: number, i1: number, mass: number): void {
  if (mass <= 0 || i1 < i0) return;
  if (i1 === i0) { probs[i0] += mass; return; }
  const ratio = 0.65;
  let wSum = 0;
  for (let i = i0; i <= i1; i++) wSum += Math.pow(ratio, i - i0);
  for (let i = i0; i <= i1; i++) probs[i] += mass * (Math.pow(ratio, i - i0) / wSum);
}

/** Spread `mass` over [i0..i1] with geometric decay rate `r` (front-loaded). */
function distributeGeometric(probs: number[], i0: number, i1: number, mass: number, r: number): void {
  if (mass <= 0 || i1 < i0) return;
  let wSum = 0;
  for (let i = i0; i <= i1; i++) wSum += Math.pow(1 - r, i - i0);
  if (wSum <= 0) { probs[i0] += mass; return; }
  for (let i = i0; i <= i1; i++) probs[i] += mass * (Math.pow(1 - r, i - i0) / wSum);
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

// ── Coherent-joint structural model (§1b, no-odds path) ──────────────────────
// The independent per-rider model double-counts: each rider's marginal puts
// ~10% mass on top-5, so Σ over the field implies ~18 top-5 finishers when only
// 5 exist (proven over-confident in the backtest). This builds ONE coherent
// finishing matrix instead: a multiplicative skill (rank-strength × stage
// suitability × form) seeds a Gaussian around each rider's skill-rank, then a
// Sinkhorn normalisation makes the matrix doubly stochastic so every finishing
// position is taken by exactly one rider and Σ P(top-k) = k by construction.
// Suitability MODULATES the dominant season-rank signal rather than competing
// with it additively (which diluted it and lost to a rank-only baseline).

/**
 * Stage "climbiness" = vertical metres per km, mapped to 0..1 (flat ≈ 8 m/km → 0,
 * hard mountain ≥ 32 m/km → 1). Returns −1 when the stage carries no vertical
 * data (so the modifier is skipped and behaviour is unchanged).
 */
export function climbiness(stage: Stage): number {
  if (!stage.verticalMeters || !stage.km) return -1;
  const mPerKm = stage.verticalMeters / Math.max(1, stage.km);
  return clamp01((mPerKm - 8) / (32 - 8));
}

/** Multiplicative per-rider skill on a stage (>0). */
export function riderSkill(
  rider: Rider,
  stage: Stage,
  cfg: EngineConfig = defaultConfig(),
): number {
  if (rider.injury === 'out') return 0;

  // TTT: the team rules the result; individual archetype barely matters.
  if (stage.type === 'ttt') {
    let s = clamp01(rider.teamStrength / 100) + 1e-3;
    if (rider.injury === 'doubt') s *= cfg.doubtDampen;
    return s;
  }

  const suit = cfg.suitability[stage.type][rider.archetype];
  const rankStrength = strengthFromRank(rider.pcsRank) / 100; // rank 1 ≈ 1.0
  const formFactor = cfg.skillFormFloor + (1 - cfg.skillFormFloor) * clamp01(rider.form / 100);
  let skill = rankStrength * suit * formFactor;

  // Continuous climbiness refines the coarse stage type (e.g. a "hilly" stage
  // with mountain-level vertical lifts climbers and drops sprinters).
  const c = climbiness(stage);
  if (c >= 0) {
    const slope = cfg.climbinessResponse[rider.archetype] ?? 0;
    skill *= Math.max(0.2, 1 + cfg.climbinessGain * slope * c);
  }

  // A strong lead-out turns a fast finisher into a real contender on flat days.
  if (rider.archetype === 'sprinter' && stage.type === 'flat' && rider.sprintTrainSupport) {
    skill *= 1 + 0.12 * (rider.sprintTrainSupport / 100);
  }
  if (rider.injury === 'doubt') skill *= cfg.doubtDampen;
  return Math.max(0, skill);
}

/** In-place Sinkhorn: scale a positive square matrix toward doubly stochastic. */
function sinkhorn(m: number[][], iters: number): void {
  const n = m.length;
  for (let it = 0; it < iters; it++) {
    // rows → 1
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 0; j < n; j++) s += m[i][j];
      if (s > 0) for (let j = 0; j < n; j++) m[i][j] /= s;
    }
    // cols → 1
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += m[i][j];
      if (s > 0) for (let i = 0; i < n; i++) m[i][j] /= s;
    }
  }
}

/**
 * Build a coherent finishing field for the no-odds case. Returns a distribution
 * per rider (length cfg.fieldSize) whose column sums ≈ 1 (one rider per slot),
 * with per-rider DNF mass folded in.
 */
export function buildCoherentField(
  riders: Rider[],
  stage: Stage,
  cfg: EngineConfig = defaultConfig(),
): RiderDistribution[] {
  const N = cfg.fieldSize;
  const starters = riders.filter((r) => r.injury !== 'out');
  const M = starters.length;
  if (M === 0) {
    return riders.map((r) => ({ riderId: r.id, probs: new Array(N).fill(0), pDNF: 0 }));
  }

  // Order starters by skill (desc); modal finishing slot = skill rank.
  const withSkill = starters.map((r) => ({ r, s: riderSkill(r, stage, cfg) }));
  const order = [...withSkill].sort((a, b) => b.s - a.s);
  const muById = new Map<string, number>();
  order.forEach((o, i) => muById.set(o.r.id, i));

  // Seed an M×M matrix: Gaussian around each rider's skill rank.
  const sigma = Math.max(2, cfg.jointSpread);
  const twoSig2 = 2 * sigma * sigma;
  const rowIndex = new Map<string, number>();
  const seed: number[][] = starters.map((r, i) => {
    rowIndex.set(r.id, i);
    const mu = muById.get(r.id)!;
    const row = new Array<number>(M);
    for (let p = 0; p < M; p++) row[p] = Math.exp(-((p - mu) ** 2) / twoSig2) + 1e-9;
    return row;
  });

  sinkhorn(seed, 40);

  return riders.map((r) => {
    if (r.injury === 'out' || !rowIndex.has(r.id)) {
      return { riderId: r.id, probs: new Array(N).fill(0), pDNF: 0 };
    }
    const pDNF = riderDnfRisk(r, stage, cfg);
    const finishMass = 1 - pDNF;
    const row = seed[rowIndex.get(r.id)!];
    const probs = new Array<number>(N).fill(0);
    for (let p = 0; p < M && p < N; p++) probs[p] = row[p] * finishMass;
    return { riderId: r.id, probs, pDNF };
  });
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
  const N = cfg.fieldSize;

  // Field strength normaliser = sum of contention strengths.
  const fieldStrength = starters.reduce(
    (acc, r) => acc + contentionStrength(r, stage, cfg),
    0,
  );

  // De-vig each odds market across the field, once. A rider is "odds-driven"
  // when it supplied at least one market; those get the calibrated anchor curve.
  const ids = starters.map((r) => r.id);
  const markets: Array<{ k: number; key: keyof NonNullable<Rider['odds']> }> = [
    { k: 1, key: 'win' }, { k: 3, key: 'top3' }, { k: 5, key: 'top5' }, { k: 10, key: 'top10' },
  ];
  const devigByMarket: Record<number, Record<string, number>> = {};
  for (const m of markets) {
    const col = starters.map((r) => r.odds?.[m.key]);
    if (!col.some((o) => o && o > 1)) continue;
    const dv = devigMarket(col, m.k);
    const map: Record<string, number> = {};
    ids.forEach((id, i) => { if (dv[i] > 0) map[id] = dv[i]; });
    devigByMarket[m.k] = map;
  }

  // No odds anywhere in the field → coherent-joint structural model (§1b).
  if (Object.keys(devigByMarket).length === 0) {
    return buildCoherentField(riders, stage, cfg);
  }

  return riders.map((r) => {
    if (r.injury === 'out') {
      return { riderId: r.id, probs: new Array(N).fill(0), pDNF: 0 };
    }
    const anchors: Anchor[] = [];
    for (const m of markets) {
      const q = devigByMarket[m.k]?.[r.id];
      if (typeof q === 'number' && q > 0) anchors.push({ k: m.k, q });
    }
    if (anchors.length > 0) {
      const raw = contentionStrength(r, stage, cfg);
      const rel = fieldStrength > 0 ? raw / fieldStrength : 0;
      const pDNF = riderDnfRisk(r, stage, cfg);
      return buildDistributionFromAnchors(r.id, anchors, pDNF, rel, N);
    }
    // No odds for this rider → model-strength geometric fallback (unchanged).
    return buildDistribution(r, stage, fieldStrength, cfg);
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
