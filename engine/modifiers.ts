// ── Optional Phase-2 modifiers: weather + news (§3.5) ────────────────────────
// These translate the optional `stage.weather` and `rider.news` fields into
// small multiplicative factors applied at well-defined hooks in the probability
// model. THE CONTRACT: when no weather/news is supplied, every function here
// returns exactly 1 (or undefined), so predictions are bit-identical to the
// validated base model. Nothing is gated on backtest because there is no
// historical weather/news corpus — instead they are conservative, neutral by
// default, and only nudge when the user (via the chat bridge) provides data.

import type { Rider, Stage } from './types';

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

// ── Weather (per stage) ──────────────────────────────────────────────────────

/**
 * Cross-wind / gust risk widens the finishing spread (echelons + splits make the
 * result less predictable). 1.0 when no weather. Capped so a storm can at most
 * ~1.5× the spread.
 */
export function weatherSpreadFactor(stage: Stage): number {
  const w = stage.weather;
  if (!w) return 1;
  let f = 1;
  if (typeof w.crosswindSections === 'number') f += 0.08 * clamp(w.crosswindSections, 0, 6);
  if (typeof w.windKph === 'number') f += 0.004 * clamp(w.windKph - 25, 0, 50); // only strong wind matters
  if (w.gustRisk === 'med') f += 0.08;
  else if (w.gustRisk === 'high') f += 0.18;
  return clamp(f, 1, 1.5);
}

/**
 * Probability the bunch SPLITS into echelons on an exposed day (0 when no
 * weather). Unlike `weatherSpreadFactor` (which widens each rider's marginal
 * independently), this drives a per-race scenario in the simulator where whole
 * TEAMS make or miss the front split together — the correlation that actually
 * decides Etapebonus on crosswind days. Caller gates it to exposed stage types.
 */
export function weatherEchelonProb(stage: Stage): number {
  const w = stage.weather;
  if (!w) return 0;
  let p = 0;
  if (typeof w.crosswindSections === 'number') p += 0.12 * clamp(w.crosswindSections, 0, 5);
  if (typeof w.windKph === 'number') p += 0.012 * clamp(w.windKph - 30, 0, 40); // only real wind
  if (w.gustRisk === 'med') p += 0.1;
  else if (w.gustRisk === 'high') p += 0.22;
  return clamp(p, 0, 0.6);
}

/** Rain + cold raise abandonment/attrition risk. 1.0 when no weather. */
export function weatherDnfFactor(stage: Stage): number {
  const w = stage.weather;
  if (!w) return 1;
  let f = 1;
  if (typeof w.rainProb === 'number') f += 0.25 * clamp(w.rainProb / 100, 0, 1); // up to +25%
  if (typeof w.tempC === 'number' && w.tempC < 8) f += 0.02 * clamp(8 - w.tempC, 0, 12); // cold
  return clamp(f, 1, 1.6);
}

/**
 * Wet / gusty days are more chaotic and slightly favour a breakaway sticking.
 * 1.0 when no weather. Cross-winds favour strong teams, NOT breaks, so they do
 * not feed this factor.
 */
export function weatherBreakFactor(stage: Stage): number {
  const w = stage.weather;
  if (!w) return 1;
  let f = 1;
  if (typeof w.rainProb === 'number') f += 0.3 * clamp(w.rainProb / 100, 0, 1);
  if (w.gustRisk === 'high') f += 0.1;
  return clamp(f, 1, 1.5);
}

/**
 * Wet roads are the single biggest driver of real pack-crash risk (braking
 * distance, painted lines/roundabouts in the technical run-in). 1.0 when no
 * weather. Feeds the simulator's correlated crash SCENARIO (a shared event
 * that catches a cluster of the field together), not an independent per-rider
 * risk — see engine/simulate.ts.
 */
export function weatherCrashFactor(stage: Stage): number {
  const w = stage.weather;
  if (!w) return 1;
  let f = 1;
  if (typeof w.rainProb === 'number') f += 0.7 * clamp(w.rainProb / 100, 0, 1); // wet roads → real pileup risk
  if (w.gustRisk === 'high') f += 0.1; // gusts push riders together/off-line too
  return clamp(f, 1, 2.2);
}

// ── News (per rider) ─────────────────────────────────────────────────────────

/**
 * Small skill multiplier from soft news. 1.0 when no news. `formDelta` is the
 * dominant lever (a ±form-points nudge mapped to a gentle skill scale); intent
 * and motivation add minor context (home roads / target lift; "saving"/"rest"
 * dampen).
 */
export function newsSkillFactor(rider: Rider): number {
  const n = rider.news;
  if (!n) return 1;
  let f = 1;
  if (typeof n.formDelta === 'number') f *= 1 + 0.5 * clamp(n.formDelta, -30, 30) / 100; // ±15% at ±30
  const ctx = `${n.motivation ?? ''} ${n.intent ?? ''}`.toLowerCase();
  if (/(home|target|peak|going well|flying)/.test(ctx)) f *= 1.05;
  if (/(sav|rest|easy|protect|recover|illness|sick)/.test(ctx)) f *= 0.9;
  return clamp(f, 0.5, 1.5);
}

/**
 * Break-propensity multiplier from intent. 1.0 when no news. A stated breakaway
 * intent / aggressive role raises the chance the rider is up the road.
 */
export function newsBreakFactor(rider: Rider): number {
  const n = rider.news;
  if (!n) return 1;
  const ctx = `${n.intent ?? ''} ${n.role ?? ''} ${n.motivation ?? ''}`.toLowerCase();
  let f = 1;
  if (/(break|attack|aggress|baroudeur|escape)/.test(ctx)) f *= 1.6;
  if (/(gc|sprint|protect|wait)/.test(ctx)) f *= 0.8;
  return clamp(f, 0.5, 2);
}
