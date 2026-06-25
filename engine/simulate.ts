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

import type { Rider, Stage, RiderDistribution } from './types';
import { EngineConfig, defaultConfig } from './config';
import { riderSkill, breakSkill, riderDnfRisk } from './probability';

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

export interface SimConfig {
  nSims: number;
  seed: number;
}
export const DEFAULT_SIM: SimConfig = { nSims: 2000, seed: 0x5eed };

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

  const bunchSkill = starters.map((r) => Math.max(1e-6, riderSkill(r, stage, cfg)));
  const brkSkill = starters.map((r) => Math.max(1e-9, breakSkill(r, stage, cfg)));
  const pDNF = starters.map((r) => riderDnfRisk(r, stage, cfg));
  const pBreak = cfg.breakawayWinRate[stage.type] ?? 0;

  const rng = mulberry32(sim.seed);
  const exp = () => -Math.log(rng() || 1e-12); // Exp(1)

  const posCount: Float64Array[] = starters.map(() => new Float64Array(N));
  const dnfCount = new Float64Array(M);

  // scratch arrays reused each sim
  const idx = new Array<number>(M);
  const key = new Float64Array(M);

  for (let s = 0; s < sim.nSims; s++) {
    const isBreak = pBreak > 0 && rng() < pBreak;

    if (!isBreak) {
      // Bunch scenario: one Plackett–Luce order over terrain skill.
      for (let i = 0; i < M; i++) {
        idx[i] = i;
        key[i] = exp() / bunchSkill[i];
      }
      idx.sort((a, b) => key[a] - key[b]);
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
      // order each sub-group by terrain skill (strongest wins the break)
      breakMembers.sort((a, b) => exp() / bunchSkill[a] - exp() / bunchSkill[b]);
      bunchMembers.sort((a, b) => exp() / bunchSkill[a] - exp() / bunchSkill[b]);
      for (let i = 0; i < M; i++) idx[i] = i < breakMembers.length ? breakMembers[i] : bunchMembers[i - breakMembers.length];
    }

    // Walk the finishing order, dropping DNFs (they take no finishing slot).
    let pos = 0;
    for (let o = 0; o < M; o++) {
      const ri = idx[o];
      if (rng() < pDNF[ri]) {
        dnfCount[ri] += 1;
        continue;
      }
      if (pos < N) posCount[ri][pos] += 1;
      pos++;
    }
  }

  const out = new Map<string, RiderDistribution>();
  starters.forEach((r, i) => {
    const probs = new Array<number>(N).fill(0);
    for (let p = 0; p < N; p++) probs[p] = posCount[i][p] / sim.nSims;
    out.set(r.id, { riderId: r.id, probs, pDNF: dnfCount[i] / sim.nSims });
  });

  return riders.map(
    (r) => out.get(r.id) ?? { riderId: r.id, probs: new Array(N).fill(0), pDNF: 0 },
  );
}
