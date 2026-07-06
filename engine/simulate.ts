// ── Monte Carlo race simulator (§3.3 / step 4) ───────────────────────────────
// A seeded, deterministic stage simulator that produces a JOINT outcome: each
// sim is a full finishing permutation, so break-vs-bunch is a per-race SCENARIO
// (one break rider wins, the bunch finishes behind) rather than a probability
// smeared across every rider's marginal — which the backtest rejected (§4d).
//
// Aggregating the sims gives coherent marginals (every position taken by one
// rider, Σ P(top-k) = k) AND, because each sim is internally consistent, the
// joint quantities the optimiser needs (Etapebonus / Holdbonus / captain) can be
// read off the same samples without the independence assumption.
//
// Sampling is Plackett–Luce: draw an exponential "race time" key_i = Exp(1)/skill
// per rider and sort ascending. Stronger skill → earlier finish. On a break
// scenario the front of the field is drawn from a breakaway pool (by breakSkill)
// and ordered for the win by terrain skill; the bunch fills in behind.

import type { Rider, Stage, RiderDistribution, JointSamples } from './types';
import { EngineConfig, defaultConfig } from './config';
import { riderSkill, breakSkill, riderDnfRisk, buildCoherentField } from './probability';
import { strengthFromRank } from './features';
import { weatherBreakFactor, weatherEchelonProb, weatherCrashFactor } from './modifiers';
import type { StackModel } from './config';

/** Stage types where echelons realistically form (exposed, raced for position). */
const ECHELON_TYPES = new Set<Stage['type']>(['flat', 'hilly']);

/** Small fast seeded PRNG (deterministic across platforms) → [0,1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** team strength (0..100) → 0..1, robust to bad data. */
function clampStr(x: number): number {
  return Number.isFinite(x) ? Math.max(0, Math.min(1, x / 100)) : 0.5;
}

export interface SimConfig {
  nSims: number;
  seed: number;
}
export const DEFAULT_SIM: SimConfig = { nSims: 4000, seed: 0x5eed };

/** Default ensemble weight on the analytic coherent model (rest → simulator). */
export const DEFAULT_ENSEMBLE_W = 0.5;

/**
 * Run the sims and invoke `onOrder(order)` once per sim with the classified
 * finishing order (array of STARTER indices, DNFs excluded, position 0 = winner).
 * Shared core for both the marginal and the joint-sample views.
 */
function forEachSimOrder(
  starters: Rider[],
  stage: Stage,
  cfg: EngineConfig,
  sim: SimConfig,
  onOrder: (order: number[]) => void,
): void {
  const M = starters.length;
  const bunchSkill = starters.map((r) => Math.max(1e-6, riderSkill(r, stage, cfg)));
  const brkSkill = starters.map((r) => Math.max(1e-9, breakSkill(r, stage, cfg)));
  const pDNF = starters.map((r) => riderDnfRisk(r, stage, cfg));
  // Optional weather nudges the break-success rate (×1 when no weather supplied).
  const pBreak = Math.min(0.6, (cfg.breakawayWinRate?.[stage.type] ?? 0) * weatherBreakFactor(stage));
  // Crosswind echelon split (per-race scenario, weather-gated, 0 when none).
  const pEcho = ECHELON_TYPES.has(stage.type) ? weatherEchelonProb(stage) : 0;
  // Correlated pack crash/pileup (per-race scenario, weather-boosted by rain).
  const pCrash = Math.min(0.3, (cfg.crashRate?.[stage.type] ?? 0) * weatherCrashFactor(stage));
  const teamStr = starters.map((r) => clampStr(r.teamStrength));
  // Index riders by team so a shared per-team shock can move teammates together.
  const teamOf = starters.map((r) => r.team);
  const teamList = [...new Set(teamOf)];
  const teamRow = new Map(teamList.map((t, i) => [t, i] as const));

  const rng = mulberry32(sim.seed);
  const exp = () => -Math.log(rng() || 1e-12); // Exp(1)
  const gauss = () => { // Box–Muller, reuses the same stream
    const u = rng() || 1e-12;
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
  };

  const idx = new Array<number>(M);
  const key = new Float64Array(M);

  for (let s = 0; s < sim.nSims; s++) {
    const isBreak = pBreak > 0 && rng() < pBreak;
    const isEcho = !isBreak && pEcho > 0 && rng() < pEcho;
    // A crash is its own bunch-day scenario (echelon days already have their
    // own chaos via the team-shock split; a break day's peloton isn't riding
    // as one group for a pack pileup to apply the same way).
    const isCrash = !isBreak && !isEcho && pCrash > 0 && rng() < pCrash;

    if (isEcho) {
      // Echelon scenario: the bunch splits and whole TEAMS make or miss the
      // front group together (a shared per-team shock), so teammates' top-15
      // outcomes are positively correlated — the real Etapebonus risk on
      // crosswind days. The front group then sprints for the win; the dropped
      // group fills in entirely behind it.
      const teamShock = teamList.map(() => gauss());
      const frontN = Math.max(1, Math.round(M * (0.35 + rng() * 0.35)));
      const frontScore = new Float64Array(M);
      for (let i = 0; i < M; i++) {
        frontScore[i] = 1.5 * teamStr[i] + 1.2 * teamShock[teamRow.get(teamOf[i])!] + gauss();
      }
      for (let i = 0; i < M; i++) idx[i] = i;
      idx.sort((a, b) => frontScore[b] - frontScore[a]); // best-positioned first
      const front = idx.slice(0, frontN);
      const back = idx.slice(frontN);
      front.sort((a, b) => exp() / bunchSkill[a] - exp() / bunchSkill[b]);
      back.sort((a, b) => exp() / bunchSkill[a] - exp() / bunchSkill[b]);
      for (let i = 0; i < M; i++) idx[i] = i < front.length ? front[i] : back[i - front.length];
    } else if (!isBreak) {
      // Bunch scenario: one Plackett–Luce order over terrain skill.
      for (let i = 0; i < M; i++) {
        idx[i] = i;
        key[i] = exp() / bunchSkill[i];
      }
      idx.sort((a, b) => key[a] - key[b]);

      if (isCrash) {
        // Correlated pack crash: a contiguous CLUSTER of the mid-pack (rarely
        // the very front, which is usually clear before a crash happens
        // behind) gets caught out together and loses the day — real cycling
        // variance an independent per-rider DNF roll can't produce (whoever is
        // unlucky enough to be riding there that moment, GC contender or
        // domestique alike, goes down together). They're pushed to the back
        // of the order; the normal per-rider DNF roll below still applies on
        // top (some of them may not finish at all).
        const start = Math.max(1, Math.floor(M * (0.15 + rng() * 0.35)));
        const width = Math.max(1, Math.round(M * (0.1 + rng() * 0.25)));
        const end = Math.min(M, start + width);
        const caught = idx.slice(start, end);
        const clear = [...idx.slice(0, start), ...idx.slice(end)];
        for (let i = 0; i < clear.length; i++) idx[i] = clear[i];
        for (let i = 0; i < caught.length; i++) idx[clear.length + i] = caught[i];
      }
    } else {
      // Break scenario: draw a break pool by break skill, then order the break
      // for the win by terrain skill; the bunch fills in behind.
      const k = 3 + Math.floor(rng() * 9); // break of ~3..11
      const bkey = new Float64Array(M);
      for (let i = 0; i < M; i++) {
        idx[i] = i;
        bkey[i] = exp() / brkSkill[i];
      }
      idx.sort((a, b) => bkey[a] - bkey[b]);
      const breakMembers = idx.slice(0, Math.min(k, M));
      const bunchMembers = idx.slice(Math.min(k, M));
      breakMembers.sort((a, b) => exp() / bunchSkill[a] - exp() / bunchSkill[b]);
      bunchMembers.sort((a, b) => exp() / bunchSkill[a] - exp() / bunchSkill[b]);
      for (let i = 0; i < M; i++) idx[i] = i < breakMembers.length ? breakMembers[i] : bunchMembers[i - breakMembers.length];
    }

    // Drop DNFs (they take no finishing slot); emit the classified order.
    const order: number[] = [];
    for (let o = 0; o < M; o++) {
      const ri = idx[o];
      if (rng() < pDNF[ri]) continue;
      order.push(ri);
    }
    onOrder(order);
  }
}

/**
 * Simulate a stage and return per-rider finishing-position marginals
 * (probs[p] = P(finish position p+1)) with DNF mass folded out (Σ probs = 1−pDNF).
 * Coherent by construction (each sim is a permutation of the starters).
 */
export function simulateStage(
  riders: Rider[],
  stage: Stage,
  cfg: EngineConfig = defaultConfig(),
  sim: SimConfig = DEFAULT_SIM,
): RiderDistribution[] {
  const N = cfg.fieldSize;
  const starters = riders.filter((r) => r.injury !== 'out');
  const M = starters.length;
  if (M === 0) {
    return riders.map((r) => ({ riderId: r.id, probs: new Array(N).fill(0), pDNF: 0 }));
  }

  const posCount: Float64Array[] = starters.map(() => new Float64Array(N));
  let finishes = new Float64Array(M);
  forEachSimOrder(starters, stage, cfg, sim, (order) => {
    for (let pos = 0; pos < order.length && pos < N; pos++) posCount[order[pos]][pos] += 1;
    for (const ri of order) finishes[ri] += 1;
  });

  const out = new Map<string, RiderDistribution>();
  starters.forEach((r, i) => {
    const probs = new Array<number>(N).fill(0);
    for (let p = 0; p < N; p++) probs[p] = posCount[i][p] / sim.nSims;
    out.set(r.id, { riderId: r.id, probs, pDNF: 1 - finishes[i] / sim.nSims });
  });

  return riders.map(
    (r) => out.get(r.id) ?? { riderId: r.id, probs: new Array(N).fill(0), pDNF: 0 },
  );
}

/**
 * Ensemble field: a convex blend of the analytic coherent model (sharpest top-5)
 * and the Monte Carlo simulator (best top-15 calibration + breakaway upside).
 * Both are coherent, so the blend is too. `w` = weight on the analytic model;
 * when omitted, the per-stage-type learned weight (`cfg.ensembleAnalyticWeight`)
 * is used so the more accurate component weighs more on each terrain.
 */
export function buildEnsembleField(
  riders: Rider[],
  stage: Stage,
  cfg: EngineConfig = defaultConfig(),
  w?: number,
  sim: SimConfig = DEFAULT_SIM,
): RiderDistribution[] {
  if (w === undefined) w = cfg.ensembleAnalyticWeight?.[stage.type] ?? DEFAULT_ENSEMBLE_W;
  const a = buildCoherentField(riders, stage, cfg);
  const s = simulateStage(riders, stage, cfg, sim);
  const sById = new Map(s.map((d) => [d.riderId, d]));
  return a.map((da) => {
    const ds = sById.get(da.riderId);
    const probs = da.probs.map((p, i) => w * p + (1 - w) * (ds?.probs[i] ?? 0));
    const pDNF = w * da.pDNF + (1 - w) * (ds?.pDNF ?? da.pDNF);
    return { riderId: da.riderId, probs, pDNF };
  });
}

// ── Logistic stacking meta-model (#1) ────────────────────────────────────────
// Combine the base signals (analytic coherent + Monte-Carlo sim) per rider with
// learned per-MARKET weights: a logistic regression maps each model's predicted
// P(top-k) — plus the rider's rank strength — to one CALIBRATED P(top-k). Rather
// than rebuild the curve from those anchors (which discards the simulator's
// well-calibrated shape), we RE-SCALE the per-terrain ensemble curve segment by
// segment so its cumulative top-k hits the calibrated anchors while the shape
// WITHIN each segment is preserved. So the signals are weighted by their
// out-of-sample accuracy (per market) AND the rich base shape is kept.

const clip01 = (p: number) => Math.max(1e-4, Math.min(1 - 1e-4, p));
const logit = (p: number) => Math.log(clip01(p) / (1 - clip01(p)));
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
const cumTopK = (probs: number[], k: number) => {
  let s = 0;
  for (let i = 0; i < k && i < probs.length; i++) s += probs[i];
  return s;
};

/**
 * Re-scale a base distribution so its cumulative P(top-k) equals each anchor's
 * target, keeping the base shape within every segment. `anchors` are sorted
 * {k, q} cumulative targets (q already monotone & ≤ finishMass).
 */
function rescaleToAnchors(base: number[], anchors: Array<{ k: number; q: number }>, finishMass: number): number[] {
  const N = base.length;
  const out = new Array<number>(N).fill(0);
  // boundaries: [lastK, k) segments, then [lastK, N) carries the rest.
  let lastK = 0;
  let lastQ = 0;
  const segs: Array<{ lo: number; hi: number; mass: number }> = [];
  for (const { k, q } of anchors) {
    segs.push({ lo: lastK, hi: Math.min(k, N), mass: Math.max(0, q - lastQ) });
    lastK = Math.min(k, N);
    lastQ = q;
  }
  segs.push({ lo: lastK, hi: N, mass: Math.max(0, finishMass - lastQ) });

  for (const { lo, hi, mass } of segs) {
    if (hi <= lo || mass <= 0) continue;
    let baseSum = 0;
    for (let i = lo; i < hi; i++) baseSum += base[i];
    if (baseSum > 1e-12) {
      for (let i = lo; i < hi; i++) out[i] = base[i] * (mass / baseSum);
    } else {
      const each = mass / (hi - lo); // base had no mass here → spread evenly
      for (let i = lo; i < hi; i++) out[i] = each;
    }
  }
  return out;
}

export function buildStackedField(
  riders: Rider[],
  stage: Stage,
  cfg: EngineConfig,
  model: StackModel,
  sim: SimConfig = DEFAULT_SIM,
): RiderDistribution[] {
  const N = cfg.fieldSize;
  const a = buildCoherentField(riders, stage, cfg);
  const s = simulateStage(riders, stage, cfg, sim);
  const aById = new Map(a.map((d) => [d.riderId, d]));
  const sById = new Map(s.map((d) => [d.riderId, d]));
  const markets = Object.keys(model).map(Number).sort((x, y) => x - y);
  const wA = cfg.ensembleAnalyticWeight?.[stage.type] ?? DEFAULT_ENSEMBLE_W;

  return riders.map((r) => {
    const da = aById.get(r.id);
    const ds = sById.get(r.id);
    if (!da || !ds) return { riderId: r.id, probs: new Array<number>(N).fill(0), pDNF: 0 };
    const rankStrength = strengthFromRank(r.pcsRank) / 100;
    // Base shape = the per-terrain ensemble curve (already sums to finishMass).
    const base = da.probs.map((p, i) => wA * p + (1 - wA) * ds.probs[i]);
    const pDNF = wA * da.pDNF + (1 - wA) * ds.pDNF;
    const finishMass = 1 - pDNF;

    // Calibrated cumulative anchors from the meta-model; clamp monotone ≤ mass.
    let prev = 0;
    const anchors = markets.map((k) => {
      const w = model[k];
      const z = w.b0
        + w.ana * logit(cumTopK(da.probs, k))
        + w.sim * logit(cumTopK(ds.probs, k))
        + w.rank * rankStrength;
      const q = Math.max(prev, Math.min(finishMass, sigmoid(z)));
      prev = q;
      return { k, q };
    });

    return { riderId: r.id, probs: rescaleToAnchors(base, anchors, finishMass), pDNF };
  });
}

// ── Joint samples (for correlated team EV: Etapebonus / Holdbonus / captain) ──
// JointSamples lives in ./types (so the optimizer can reference it without a
// circular import); re-exported here for existing call sites.
export type { JointSamples };

/**
 * Simulate a stage and return BOTH the marginals and the per-sim joint samples
 * needed to score a team's Etapebonus/Holdbonus on the EXACT same realisations
 * (so teammate correlation and break scenarios are respected, not assumed
 * independent).
 */
export function simulateJoint(
  riders: Rider[],
  stage: Stage,
  cfg: EngineConfig = defaultConfig(),
  sim: SimConfig = DEFAULT_SIM,
): { distributions: RiderDistribution[]; samples: JointSamples } {
  const N = cfg.fieldSize;
  const starters = riders.filter((r) => r.injury !== 'out');
  const M = starters.length;
  const distributions = simulateStage(riders, stage, cfg, sim);
  if (M === 0) {
    return { distributions, samples: { starterIds: [], nSims: sim.nSims, top15: [], winner: [] } };
  }
  const top15: number[][] = [];
  const winner: number[] = [];
  forEachSimOrder(starters, stage, cfg, sim, (order) => {
    top15.push(order.slice(0, Math.min(15, order.length)));
    winner.push(order.length ? order[0] : -1);
  });
  return { distributions, samples: { starterIds: starters.map((r) => r.id), nSims: sim.nSims, top15, winner } };
}

/**
 * Expected Etapebonus for a team, computed JOINTLY from the sim samples: per sim
 * count how many of the team's riders are top-15, look up the tier, average.
 * `teamIdx` = the team's rider indices into `samples.starterIds`.
 */
export function jointEtapebonus(
  teamIdx: Set<number>,
  samples: JointSamples,
  etapebonusFn: (n: number) => number,
): number {
  if (samples.nSims === 0) return 0;
  let total = 0;
  for (let s = 0; s < samples.top15.length; s++) {
    let count = 0;
    for (const ri of samples.top15[s]) if (teamIdx.has(ri)) count++;
    total += etapebonusFn(count);
  }
  return total / samples.nSims;
}
