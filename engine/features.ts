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

/** Best (lowest) PCS season rank over the trailing seasons up to `year`. */
export function baselinePcsRank(history: SeasonHistoryRow[], year: number): number {
  const recent = history.filter((h) => h.season <= year && h.season >= year - 2);
  // Prefer an established rank; early in `year` the current-season rank is noisy
  // (few points), so fall back to the previous season when this one is thin.
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
