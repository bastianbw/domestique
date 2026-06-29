// ── Shared multi-year backtest harness primitives ────────────────────────────
// Loads the scraped corpora (results_<year>.json + riders.json), derives rider
// features as-of each stage's date/year, and exposes roster/stage builders +
// an empirical suitability estimator used by the parameter fitter (fit.bt.ts).
// Pure-ish: only fs + the engine. See docs/PREDICTION_MODEL_UPGRADE.md.

import fs from 'node:fs';
import path from 'node:path';
import type { Rider, Stage, StageType } from '../engine/types';
import type { SuitabilityMatrix } from '../engine/config';
import {
  classifyArchetype,
  computeForm,
  computeTerrainAffinity,
  baselinePcsRank,
  strengthFromRank,
  breakawayTendency,
  type RiderProfile,
  type StageRow2026,
} from '../engine/features';
import type { ActualFinish } from '../engine/backtest';
import type { Archetype } from '../engine/types';
import { priorRating, ratingToRank, updateStage } from '../engine/elo';

export const HIST = path.join(process.cwd(), 'data', 'historical');
export const MIN_FINISHERS = 30;

export interface TimelineEntry { date: string; rank: number; level: number; breakKm: number; type: StageType }
export interface Corpus {
  stages: (StageRow2026 & { year: number })[];
  profile: Map<string, RiderProfile>;
  timeline: Map<string, TimelineEntry[]>;
  /** as-of dynamic rating per (stage url → rider url), filled by computeEloAsOf. */
  eloAsOf?: Map<string, Map<string, number>>;
}

/**
 * Run the Elo through the corpus in date order and record, for each stage, every
 * finisher's rating BEFORE that stage updated it (strictly as-of, no leakage).
 */
export function computeEloAsOf(c: Corpus): Map<string, Map<string, number>> {
  const ratings = new Map<string, number>();
  const asOf = new Map<string, Map<string, number>>();
  const sorted = [...c.stages].filter((s) => s.date).sort((a, b) => (a.date! < b.date! ? -1 : 1));
  for (const s of sorted) {
    const order = s.results
      .filter((r) => r.rank != null && r.rank >= 1 && r.riderUrl)
      .sort((a, b) => a.rank! - b.rank!)
      .map((r) => r.riderUrl!);
    for (const url of order) {
      if (!ratings.has(url)) {
        const prof = c.profile.get(url);
        ratings.set(url, priorRating(prof ? baselinePcsRank(prof.seasonHistory, s.year) : 900));
      }
    }
    const snap = new Map<string, number>();
    for (const url of order) snap.set(url, ratings.get(url)!);
    asOf.set(s.url, snap);
    updateStage(ratings, order);
  }
  c.eloAsOf = asOf;
  return asOf;
}

export function corpusYears(): number[] {
  return fs
    .readdirSync(HIST)
    .map((f) => /^results_(\d{4})\.json$/.exec(f))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => Number(m[1]))
    .sort();
}

export function loadCorpus(years: number[]): Corpus {
  const profileRaw = JSON.parse(fs.readFileSync(path.join(HIST, 'riders.json'), 'utf-8')) as { riders: RiderProfile[] };
  const profile = new Map<string, RiderProfile>();
  for (const r of profileRaw.riders) profile.set(r.url, r);

  const stages: (StageRow2026 & { year: number })[] = [];
  const timeline = new Map<string, TimelineEntry[]>();
  for (const year of years) {
    const p = path.join(HIST, `results_${year}.json`);
    if (!fs.existsSync(p)) continue;
    const data = JSON.parse(fs.readFileSync(p, 'utf-8')) as { stages: StageRow2026[] };
    for (const s of data.stages) {
      stages.push({ ...s, year });
      if (!s.date) continue;
      const level = s.startlistQuality ?? 0;
      for (const row of s.results) {
        if (!row.riderUrl || row.rank == null || row.rank < 1) continue;
        const arr = timeline.get(row.riderUrl) ?? [];
        arr.push({ date: s.date, rank: row.rank, level, breakKm: row.breakawayKms ?? 0, type: s.ourType });
        timeline.set(row.riderUrl, arr);
      }
    }
  }
  return { stages, profile, timeline };
}

export function dataAvailable(): boolean {
  return fs.existsSync(path.join(HIST, 'riders.json')) && corpusYears().length > 0;
}

export interface RosterOpts { terrainForm?: boolean; terrainAffinity?: boolean; elo?: boolean }

export function buildRoster(
  s: StageRow2026 & { year: number },
  c: Corpus,
  opts: RosterOpts = {},
): { roster: Rider[]; actuals: ActualFinish[] } {
  const asOf = s.date ?? `${s.year}-12-31`;
  const roster: Rider[] = [];
  const actuals: ActualFinish[] = [];
  const seen = new Set<string>();

  for (const row of s.results) {
    if (row.rank == null || row.rank < 1) continue;
    const id = row.riderUrl ?? `noid:${row.rider}:${row.bib ?? ''}`;
    if (seen.has(id)) continue;
    seen.add(id);

    const prof = row.riderUrl ? c.profile.get(row.riderUrl) : undefined;
    const archetype = prof ? classifyArchetype(prof.speciality) : 'domestique';
    let pcsRank = prof ? baselinePcsRank(prof.seasonHistory, s.year) : 900;
    if (opts.elo && c.eloAsOf) {
      const rating = c.eloAsOf.get(s.url)?.get(row.riderUrl ?? '');
      if (rating !== undefined) pcsRank = ratingToRank(rating); // dynamic rating → rank
    }
    const tl = (row.riderUrl ? c.timeline.get(row.riderUrl) : undefined) ?? [];
    const past = tl.filter((e) => e.date < asOf);
    const form = computeForm(past, asOf, 45, opts.terrainForm ? (s.ourType as StageType) : undefined);
    const brk = breakawayTendency(past.map((e) => e.breakKm));
    const terrainAffinity = opts.terrainAffinity
      ? computeTerrainAffinity(past.map((e) => ({ type: e.type, rank: e.rank })))
      : undefined;

    roster.push({
      id, name: row.rider, team: row.team ?? 'UNK', archetype,
      price: 1, form, pcsRank, teamStrength: 50, injury: 'fit', breakawayTendency: brk,
      terrainAffinity,
    });
    actuals.push({ riderId: id, rank: row.rank });
  }

  const byTeam = new Map<string, number[]>();
  for (const r of roster) {
    const arr = byTeam.get(r.team) ?? [];
    arr.push(strengthFromRank(r.pcsRank));
    byTeam.set(r.team, arr);
  }
  for (const r of roster) {
    const arr = byTeam.get(r.team)!;
    r.teamStrength = arr.reduce((a, b) => a + b, 0) / arr.length;
  }
  return { roster, actuals };
}

export function toStage(s: StageRow2026): Stage {
  return {
    stage: s.stage, date: s.date ?? '', type: s.ourType as StageType, route: s.race,
    km: s.distance ?? 0, note: '', sprintPtsOnOffer: 0, mtnPtsOnOffer: 0,
    profileScore: s.profileScore ?? undefined,
    verticalMeters: s.verticalMeters ?? undefined,
    startlistQuality: s.startlistQuality ?? undefined,
  };
}

export function usableStage(s: StageRow2026): boolean {
  if (s.ourType === 'ttt') return false;
  return s.results.filter((r) => r.rank != null && r.rank >= 1).length >= MIN_FINISHERS;
}

/**
 * Empirically estimate the suitability matrix from training stages using each
 * archetype's **top-K propensity** on each stage type — the rate at which a rider
 * of that archetype finishes in the top K — which separates the head far better
 * than a mean-position average (a sprinter's top-10 rate is ~0.3 on flat, ~0.02
 * uphill). Laplace-smoothed toward the type's base rate, normalised per type to
 * max = 1, then blended with the hand-tuned `prior` at weight `beta` (beta=1 →
 * pure data, 0 → pure prior) so the estimate can never underperform the prior.
 */
export function estimateSuitability(
  c: Corpus,
  trainYears: Set<number>,
  prior: SuitabilityMatrix,
  beta = 1,
  topK = 10,
  smooth = 20,
): SuitabilityMatrix {
  const types: StageType[] = ['flat', 'hilly', 'summit', 'high_mtn', 'ttt', 'hilly_itt'];
  const archs: Archetype[] = ['sprinter', 'puncheur', 'climber', 'gc', 'rouleur', 'breakaway', 'domestique'];
  const hit: Record<string, Record<string, number>> = {};
  const tot: Record<string, Record<string, number>> = {};
  let globalHit = 0;
  let globalTot = 0;
  for (const t of types) { hit[t] = {}; tot[t] = {}; for (const a of archs) { hit[t][a] = 0; tot[t][a] = 0; } }

  for (const s of c.stages) {
    if (!trainYears.has(s.year) || !usableStage(s)) continue;
    const t = s.ourType as StageType;
    for (const row of s.results) {
      if (row.rank == null || row.rank < 1 || !row.riderUrl) continue;
      const prof = c.profile.get(row.riderUrl);
      const a = prof ? classifyArchetype(prof.speciality) : 'domestique';
      const isHit = row.rank <= topK ? 1 : 0;
      hit[t][a] += isHit;
      tot[t][a] += 1;
      globalHit += isHit;
      globalTot += 1;
    }
  }
  const baseRate = globalTot > 0 ? globalHit / globalTot : 0.1;

  const out: SuitabilityMatrix = JSON.parse(JSON.stringify(prior));
  for (const t of types) {
    const rate: Record<string, number> = {};
    let max = 0;
    for (const a of archs) {
      // Laplace-smoothed top-K rate toward the global base rate.
      rate[a] = (hit[t][a] + smooth * baseRate) / (tot[t][a] + smooth);
      if (rate[a] > max) max = rate[a];
    }
    if (max <= 0) continue;
    for (const a of archs) {
      const learned = clamp01(rate[a] / max);
      out[t][a] = beta * learned + (1 - beta) * prior[t][a];
    }
  }
  return out;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/**
 * L2-regularised logistic regression via batch gradient descent. `rows` carry a
 * feature vector `x` (WITHOUT the intercept term) and a binary label `y`; returns
 * weights `[b0, w1, w2, …]` (intercept first). Standardises features internally
 * for stable steps, then folds the scaling back into the returned weights.
 */
export function fitLogistic(
  rows: Array<{ x: number[]; y: number }>,
  l2 = 1.0,
  iters = 400,
  lr = 0.3,
): number[] {
  const n = rows.length;
  const d = n ? rows[0].x.length : 0;
  if (!n || !d) return new Array(d + 1).fill(0);

  // standardise each feature (mean 0, sd 1) for conditioning
  const mean = new Array(d).fill(0);
  const sd = new Array(d).fill(0);
  for (const r of rows) for (let j = 0; j < d; j++) mean[j] += r.x[j];
  for (let j = 0; j < d; j++) mean[j] /= n;
  for (const r of rows) for (let j = 0; j < d; j++) sd[j] += (r.x[j] - mean[j]) ** 2;
  for (let j = 0; j < d; j++) sd[j] = Math.sqrt(sd[j] / n) || 1;
  const X = rows.map((r) => r.x.map((v, j) => (v - mean[j]) / sd[j]));

  const w = new Array(d).fill(0); // standardised-space weights
  let b = 0;
  for (let it = 0; it < iters; it++) {
    const gw = new Array(d).fill(0);
    let gb = 0;
    for (let i = 0; i < n; i++) {
      let z = b;
      for (let j = 0; j < d; j++) z += w[j] * X[i][j];
      const p = 1 / (1 + Math.exp(-z));
      const e = p - rows[i].y;
      gb += e;
      for (let j = 0; j < d; j++) gw[j] += e * X[i][j];
    }
    b -= lr * (gb / n);
    for (let j = 0; j < d; j++) w[j] -= lr * (gw[j] / n + (l2 / n) * w[j]);
  }

  // unfold standardisation: z = b + Σ w_j (x_j − mean_j)/sd_j
  const out = new Array(d + 1).fill(0);
  let b0 = b;
  for (let j = 0; j < d; j++) {
    out[j + 1] = w[j] / sd[j];
    b0 -= (w[j] * mean[j]) / sd[j];
  }
  out[0] = b0;
  return out;
}
