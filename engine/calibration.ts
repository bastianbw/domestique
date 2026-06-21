// ── Calibration loop (§4, §8.9) ──────────────────────────────────────────────
// After a stage is logged, compare predicted vs actual finishing positions and
// nudge the stage-type × archetype suitability matrix with a conservative EMA
// correction. Transparent: returns the before/after deltas so the UI can show
// (and the user can undo) every adjustment.

import type { Rider, Stage, StageResultBlock, Archetype } from './types';
import { EngineConfig } from './config';
import { projectField } from './growth';
import { matchRider } from './importSchema';

/** Default learning rate — deliberately small so the model moves slowly. */
export const DEFAULT_LEARNING_RATE = 0.08;

export interface CalibrationDelta {
  archetype: Archetype;
  before: number;
  after: number;
  delta: number;
}

export interface CalibrationReport {
  stage: number;
  stageType: Stage['type'];
  learningRate: number;
  /** mean signed error: positive = model under-rated this archetype on this profile */
  deltas: CalibrationDelta[];
  /** rough per-stage accuracy: mean |predicted top-15 prob − actual top-15 (0/1)| */
  brierLike: number;
}

/**
 * Compute a calibration correction from one logged stage and return BOTH the
 * proposed new config and a transparent report. The caller decides whether to
 * apply (auto-apply small corrections per §8.9) or revert.
 */
export function calibrate(
  cfg: EngineConfig,
  stage: Stage,
  block: StageResultBlock,
  roster: Rider[],
  learningRate = DEFAULT_LEARNING_RATE,
): { next: EngineConfig; report: CalibrationReport } {
  const projs = projectField(roster, stage, cfg);
  const projById = new Map(projs.map((p) => [p.riderId, p]));

  // Actual top-15 membership from the block.
  const actualTop15 = new Set<string>();
  for (const row of block.results) {
    if (row.pos >= 1 && row.pos <= 15) {
      const m = matchRider(row.rider, roster);
      if (m.riderId) actualTop15.add(m.riderId);
    }
  }

  // Per-archetype signed error: actual top-15 rate − predicted P(top15).
  const sumErr: Record<string, number> = {};
  const count: Record<string, number> = {};
  let brierSum = 0;
  let brierN = 0;

  for (const r of roster) {
    if (r.injury === 'out') continue;
    const p = projById.get(r.id);
    if (!p) continue;
    const actual = actualTop15.has(r.id) ? 1 : 0;
    const err = actual - p.pTop15;
    sumErr[r.archetype] = (sumErr[r.archetype] ?? 0) + err;
    count[r.archetype] = (count[r.archetype] ?? 0) + 1;
    brierSum += Math.abs(err);
    brierN++;
  }

  const next: EngineConfig = {
    ...cfg,
    suitability: JSON.parse(JSON.stringify(cfg.suitability)),
  };
  const deltas: CalibrationDelta[] = [];

  for (const arch of Object.keys(count) as Archetype[]) {
    const meanErr = sumErr[arch] / Math.max(1, count[arch]);
    const before = cfg.suitability[stage.type][arch];
    // Nudge suitability toward reality, clamped to [0, 1.2].
    const after = clamp(before + learningRate * meanErr, 0, 1.2);
    next.suitability[stage.type][arch] = after;
    if (Math.abs(after - before) > 1e-6) {
      deltas.push({ archetype: arch, before, after, delta: after - before });
    }
  }

  return {
    next,
    report: {
      stage: stage.stage,
      stageType: stage.type,
      learningRate,
      deltas,
      brierLike: brierN ? brierSum / brierN : 0,
    },
  };
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
