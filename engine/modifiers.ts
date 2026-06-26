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
