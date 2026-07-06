// ── Feature derivation from the historical PCS corpus (§1, upgrade) ──────────
// Pure functions that turn scraped ProCyclingStats data into the engine's Rider
// features: archetype (from the specialty-points vector), a recency-weighted
// FORM signal, a baseline strength / pcsRank prior (from season history), and a
// data-driven breakaway tendency (from breakaway-kms). No fs, no DOM — the data
// is loaded by scripts/run_backtest.ts and passed in.
//
// See docs/PREDICTION_MODEL_UPGRADE.md §1.

import type { Archetype, StageType } from './types';

// ── Data contracts mirroring data/historical/*.json ──────────────────────────

export interface SpecialityVector {
  one_day_races?: number;
  gc?: number;
  time_trial?: number;
  sprint?: number;
  climber?: number;
  hills?: number;
}

export interface SeasonHistoryRow {
  season: number;
  points: number;
  rank: number;
}

export interface RiderProfile {
  url: string;
  name: string;
  nationality?: string | null;
  speciality: SpecialityVector;
  seasonHistory: SeasonHistoryRow[];
  team2026?: string | null;
}

export interface ResultRow2026 {
  rider: string;
  riderUrl?: string | null;
  bib?: number | null;
  team?: string | null;
  rank?: number | null;
  status?: string | null;
  time?: string | null;
  pcsPoints?: number | null;
  breakawayKms?: number | null;
}

export interface StageRow2026 {
  race: string;
  stage: number;
  url: string;
  date?: string | null;
  distance?: number | null;
  stageType?: string | null;
  profileIcon?: string | null;
  profileScore?: number | null;
  verticalMeters?: number | null;
  startlistQuality?: number | null;
  isOneDay?: boolean;
  ourType: import('./types').StageType;
  results: ResultRow2026[];
}

// ── Archetype classification ──────────────────────────────────────────────────

/**
 * Classify a rider into one of our archetypes from the PCS specialty-points
 * vector (career-cumulative points per discipline). GC is treated specially: a
 * rider with substantial GC points relative to their best discipline is a stage-
 * race leader even when climbing/one-day points are numerically larger.
 * `breakaway`/`domestique` are not derivable from specialty alone — domestique is
 * inferred from a very low career total; breakaway is carried by the separate
 * breakawayTendency field rather than the archetype.
 */
export function classifyArchetype(spec: SpecialityVector): Archetype {
  const s = {
    oneDay: spec.one_day_races ?? 0,
    gc: spec.gc ?? 0,
    tt: spec.time_trial ?? 0,
    sprint: spec.sprint ?? 0,
    climber: spec.climber ?? 0,
    hills: spec.hills ?? 0,
  };
  const total = s.oneDay + s.gc + s.tt + s.sprint + s.climber + s.hills;
  if (total < 150) return 'domestique';

  // GC override: a real stage-race rider.
  const bestDiscipline = Math.max(s.climber, s.oneDay, s.sprint, s.hills);
  if (s.gc > 1200 && s.gc >= 0.5 * bestDiscipline) return 'gc';

  const score: Record<Exclude<Archetype, 'gc' | 'breakaway' | 'domestique'>, number> = {
    sprinter: s.sprint,
    climber: s.climber,
    puncheur: s.hills + 0.35 * s.oneDay,
    rouleur: s.tt + 0.5 * s.oneDay,
  };
  let best: Archetype = 'rouleur';
  let bestV = -1;
  for (const [a, v] of Object.entries(score)) {
    if (v > bestV) {
      bestV = v;
      best = a as Archetype;
    }
  }
  return best;
}

// ── Baseline strength / pcsRank prior (slow-moving) ───────────────────────────

/**
 * Best (lowest) PCS season rank over the trailing seasons up to `year`. This
 * is a deliberately SLOW-MOVING skill-ceiling prior (an "established level"),
 * not a live ranking — recency-sensitive current-season performance belongs
 * in `computeForm` instead. Early in `year` the current-season rank is noisy
 * (few points), so fall back to the previous season when this one is thin.
 */
export function baselinePcsRank(history: SeasonHistoryRow[], year: number): number {
  const recent = history.filter((h) => h.season <= year && h.season >= year - 2);
  const cur = recent.find((h) => h.season === year);
  if (cur && cur.points >= 200) return cur.rank;
  const ranks = recent.filter((h) => h.points >= 50).map((h) => h.rank);
  return ranks.length ? Math.min(...ranks) : 900;
}

/** Map a PCS season rank to a 0..100 strength (1 → ~100, decays smoothly). */
export function strengthFromRank(rank: number): number {
  return clamp(100 * Math.exp(-(Math.max(1, rank) - 1) / 120), 0, 100);
}

// ── Form (fast-moving, recency × quality weighted) ────────────────────────────

export const FORM_HALFLIFE_DAYS = 30;
export const FORM_WINDOW_DAYS = 75;

/** Finishing-position quality: 1.0 for a win, decaying through the top group. */
export function positionQuality(rank: number): number {
  if (!rank || rank < 1) return 0;
  return Math.exp(-(rank - 1) / 12); // ~0.46 @10th, ~0.31 @15th
}

export interface FormResult {
  date?: string | null;
  rank?: number | null;
  /** race level proxy (PCS startlist-quality of the stage) */
  level?: number | null;
  /** the past stage's type, for terrain-specific form weighting */
  type?: StageType | null;
}

/**
 * Terrain similarity 0..1 between two stage types — how transferable form on one
 * is to the other. Same type = 1; neighbours on the flat→mountain axis decay;
 * TT is its own axis. Used to weight a rider's recent results toward the kind of
 * stage being predicted (a climber's recent mountain form counts most uphill).
 */
export function terrainSimilarity(a: StageType, b: StageType): number {
  if (a === b) return 1;
  const axis: Record<StageType, number> = {
    flat: 0, hilly: 1, summit: 2, high_mtn: 2.2, ttt: NaN, hilly_itt: NaN,
  };
  const ia = axis[a];
  const ib = axis[b];
  if (Number.isNaN(ia) || Number.isNaN(ib)) {
    // time-trial types only transfer to themselves (handled above) / weakly else
    return a === 'ttt' || b === 'ttt' || a === 'hilly_itt' || b === 'hilly_itt' ? 0.25 : 0.4;
  }
  return clamp(1 - Math.abs(ia - ib) / 2.5, 0.2, 1);
}

/**
 * Recency- and level-weighted mean finishing quality over the trailing window
 * before `asOf` (ISO date). Returns 0..100. When `targetType` is given, results
 * are additionally weighted by terrain similarity → terrain-specific form.
 */
export function computeForm(
  results: FormResult[],
  asOf: string,
  fallback = 45,
  targetType?: StageType,
): number {
  const asOfMs = Date.parse(asOf);
  if (!Number.isFinite(asOfMs)) return fallback;
  let wsum = 0;
  let vsum = 0;
  for (const r of results) {
    if (!r.date || r.rank == null || r.rank < 1) continue;
    const t = Date.parse(r.date);
    if (!Number.isFinite(t) || t >= asOfMs) continue; // strictly past only
    const ageDays = (asOfMs - t) / 86_400_000;
    if (ageDays > FORM_WINDOW_DAYS) continue;
    const recency = Math.pow(0.5, ageDays / FORM_HALFLIFE_DAYS);
    const level = r.level && r.level > 0 ? clamp(r.level / 1000, 0.3, 1) : 0.5;
    const terrain = targetType && r.type ? terrainSimilarity(r.type, targetType) : 1;
    const w = recency * level * terrain;
    wsum += w;
    vsum += w * positionQuality(r.rank);
  }
  if (wsum <= 0) return fallback;
  return clamp(vsum / wsum, 0, 1) * 100;
}

// ── Per-rider terrain affinity (empirical-Bayes, structural) ──────────────────

/** Prior strength (in pseudo-results) the affinity is shrunk toward 1 with. */
export const TERRAIN_AFFINITY_PRIOR = 6;
/** Clamp on the learned multiplier so a small sample can't dominate. Trades a
 *  small top-5 discrimination cost for a clear top-15 / placement-MAE gain — the
 *  metrics that drive Etapebonus and total expected value. */
export const TERRAIN_AFFINITY_CLAMP: [number, number] = [0.55, 1.7];

/** Terrain families: sparse stage types share a bucket to get enough samples. */
const TERRAIN_FAMILY: Record<StageType, 'flat' | 'hilly' | 'mountain' | 'tt'> = {
  flat: 'flat', hilly: 'hilly', summit: 'mountain', high_mtn: 'mountain',
  ttt: 'tt', hilly_itt: 'tt',
};

export interface TerrainResult { type?: StageType | null; rank?: number | null; level?: number | null }

/**
 * Race-strength weight from PCS startlist quality: a result at Tour-level
 * depth (SQ ~1700+) counts for meaningfully more than the same finish at a
 * merely-solid race (a Giro-tier SQ ~900-1000), so a rider whose best mountain
 * results all came against a shallower field (e.g. a Giro run in a year the
 * strongest climbers rode the Tour instead) doesn't get the same terrain
 * multiplier as one who did it against the Tour's own depth. Deliberately a
 * WIDER range than computeForm's clamp(level/1000, 0.3, 1) — that ceiling was
 * tuned to gently damp recent-form noise, but a hard cap at 1.0 flattens
 * exactly the Tour-vs-Giro gap this is meant to capture (both would round to
 * ~1.0), so this keeps a real top end up to double the Tour's own SQ.
 */
function raceStrengthWeight(level?: number | null): number {
  return level && level > 0 ? clamp(level / 1000, 0.3, 2) : 0.7;
}

/**
 * Learn a per-stage-type skill multiplier from a rider's OWN past results: how
 * much better/worse they finish on each terrain family vs their overall level,
 * empirical-Bayes shrunk toward 1 by (race-strength-weighted) sample count.
 * Returns a multiplier per StageType (neutral families omitted). Personalises
 * within an archetype — a sprinter who climbs well lifts on mountains; a pure
 * sprinter sinks.
 */
export function computeTerrainAffinity(results: TerrainResult[]): Partial<Record<StageType, number>> {
  const valid = results.filter((r) => r.type && r.rank != null && r.rank >= 1) as Array<{ type: StageType; rank: number; level?: number | null }>;
  if (valid.length < TERRAIN_AFFINITY_PRIOR) return {}; // too thin → trust the archetype prior

  // The rider's own baseline level is intentionally UNWEIGHTED — a stable
  // reference point to compare each family against. If race strength reweighted
  // this too, emphasising one family's evidence would also drag the baseline
  // toward that same family, muting rather than amplifying the very gap this
  // is meant to capture (a bigger mountain weight pulls "overall" toward the
  // mountain mean, shrinking mountain/overall back toward 1 — the opposite of
  // trusting a Tour-level result more).
  const overall = valid.reduce((a, r) => a + positionQuality(r.rank), 0) / valid.length;
  if (overall <= 1e-6) return {};

  const byFam = new Map<string, { sum: number; wsum: number }>();
  for (const r of valid) {
    const fam = TERRAIN_FAMILY[r.type];
    const w = raceStrengthWeight(r.level);
    const acc = byFam.get(fam) ?? { sum: 0, wsum: 0 };
    acc.sum += w * positionQuality(r.rank);
    acc.wsum += w;
    byFam.set(fam, acc);
  }

  const famMult = new Map<string, number>();
  for (const [fam, { sum, wsum }] of byFam) {
    if (wsum <= 0) continue;
    const mean = sum / wsum;
    // shrink the family mean toward the rider's overall level (weighted sample
    // size, so a few Tour-level results are trusted more than the same COUNT
    // of results from a weaker field), then ratio it.
    const shrunk = (wsum * mean + TERRAIN_AFFINITY_PRIOR * overall) / (wsum + TERRAIN_AFFINITY_PRIOR);
    famMult.set(fam, clamp(shrunk / overall, TERRAIN_AFFINITY_CLAMP[0], TERRAIN_AFFINITY_CLAMP[1]));
  }

  const out: Partial<Record<StageType, number>> = {};
  for (const [type, fam] of Object.entries(TERRAIN_FAMILY) as Array<[StageType, string]>) {
    const m = famMult.get(fam);
    if (m !== undefined && Math.abs(m - 1) > 1e-3) out[type] = m;
  }
  return out;
}

// ── Breakaway tendency (data-driven, from breakaway-kms) ──────────────────────

/** Mean breakaway-kms across finished results → a 0..100 tendency. */
export function breakawayTendency(breakawayKmsPerRace: number[]): number {
  const vals = breakawayKmsPerRace.filter((k) => Number.isFinite(k));
  if (!vals.length) return 0;
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return clamp(avg * 1.5, 0, 100);
}

// helpers
function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
