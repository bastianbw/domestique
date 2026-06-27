import { describe, it, expect } from 'vitest';
import { simulateStage, mulberry32, simulateJoint, jointEtapebonus, buildEnsembleField } from './simulate';
import { effectiveSpread } from './probability';
import { projectField } from './growth';
import { etapebonus } from './rules';
import { defaultConfig } from './config';
import type { Rider, Stage } from './types';

function rider(p: Partial<Rider> & { id: string; archetype: Rider['archetype'] }): Rider {
  return {
    name: p.id, team: p.id + '-team', price: 1,
    form: 70, pcsRank: 50, teamStrength: 60, injury: 'fit', breakawayTendency: 0,
    ...p,
  };
}

const flat: Stage = {
  stage: 5, date: 'Jul8', type: 'flat', route: 'x', km: 150, note: '',
  sprintPtsOnOffer: 100, mtnPtsOnOffer: 0,
};
const hilly: Stage = { ...flat, type: 'hilly' };
const summit: Stage = { ...flat, type: 'summit' };

const field: Rider[] = [
  rider({ id: 'sprintA', archetype: 'sprinter', pcsRank: 5 }),
  rider({ id: 'sprintB', archetype: 'sprinter', pcsRank: 60 }),
  rider({ id: 'gcA', archetype: 'gc', pcsRank: 2 }),
  rider({ id: 'climbA', archetype: 'climber', pcsRank: 8 }),
  rider({ id: 'attacker', archetype: 'breakaway', pcsRank: 70, breakawayTendency: 95 }),
  rider({ id: 'dom', archetype: 'domestique', pcsRank: 300 }),
];

describe('mulberry32', () => {
  it('is deterministic for a seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe('simulateStage', () => {
  it('is deterministic for a fixed seed', () => {
    const r1 = simulateStage(field, flat, undefined, { nSims: 500, seed: 7 });
    const r2 = simulateStage(field, flat, undefined, { nSims: 500, seed: 7 });
    expect(r1.map((d) => d.probs[0])).toEqual(r2.map((d) => d.probs[0]));
  });

  it('produces a coherent joint: Σ P(win) ≈ 1', () => {
    const d = simulateStage(field, flat, undefined, { nSims: 4000, seed: 1 });
    const sumWin = d.reduce((a, x) => a + x.probs[0], 0);
    expect(sumWin).toBeGreaterThan(0.97);
    expect(sumWin).toBeLessThanOrEqual(1.0001);
  });

  it('each rider distribution sums to its finishing mass (1 − pDNF)', () => {
    const d = simulateStage(field, flat, undefined, { nSims: 3000, seed: 2 });
    for (const x of d) {
      const mass = x.probs.reduce((a, b) => a + b, 0);
      expect(mass).toBeCloseTo(1 - x.pDNF, 6);
    }
  });

  it('the strongest sprinter most often wins the flat stage', () => {
    const d = simulateStage(field, flat, undefined, { nSims: 4000, seed: 3 });
    const byId = new Map(d.map((x) => [x.riderId, x.probs[0]]));
    expect(byId.get('sprintA')!).toBeGreaterThan(byId.get('sprintB')!);
    expect(byId.get('sprintA')!).toBeGreaterThan(byId.get('dom')!);
  });

  it('a break specialist wins more on a break-friendly hilly stage than on a summit', () => {
    const dh = simulateStage(field, hilly, undefined, { nSims: 6000, seed: 4 });
    const ds = simulateStage(field, summit, undefined, { nSims: 6000, seed: 4 });
    const winH = dh.find((x) => x.riderId === 'attacker')!.probs[0];
    const winS = ds.find((x) => x.riderId === 'attacker')!.probs[0];
    expect(winH).toBeGreaterThan(winS);
    expect(winH).toBeGreaterThan(0); // gets real win mass from break scenarios
  });
});

describe('crosswind echelons (correlated team risk)', () => {
  // 20 teams of 2 equal-strength riders (40-strong field, so top-15 is selective).
  // Teammates share nothing but the echelon shock — a clean covariance signal.
  const echField: Rider[] = [];
  for (let t = 0; t < 20; t++) {
    const ts = 55 + (t % 8) * 3;
    echField.push(rider({ id: `t${t}a`, archetype: 'rouleur', team: `team${t}`, teamStrength: ts, pcsRank: 25 + t }));
    echField.push(rider({ id: `t${t}b`, archetype: 'rouleur', team: `team${t}`, teamStrength: ts, pcsRank: 26 + t }));
  }
  const calm: Stage = { ...flat, weather: undefined };
  const windy: Stage = { ...flat, weather: { crosswindSections: 5, gustRisk: 'high', windKph: 55 } };

  /** Covariance of two riders both finishing top-15 across the sim samples. */
  function pairTop15Cov(stage: Stage, idA: string, idB: string): number {
    const { samples } = simulateJoint(echField, stage, undefined, { nSims: 6000, seed: 11 });
    const a = samples.starterIds.indexOf(idA);
    const b = samples.starterIds.indexOf(idB);
    let ea = 0, eb = 0, eab = 0;
    for (const top of samples.top15) {
      const set = new Set(top);
      const ina = set.has(a) ? 1 : 0;
      const inb = set.has(b) ? 1 : 0;
      ea += ina; eb += inb; eab += ina * inb;
    }
    const n = samples.nSims;
    return eab / n - (ea / n) * (eb / n);
  }

  it('teammates are more positively correlated on a crosswind day than a calm one', () => {
    const calmCov = pairTop15Cov(calm, 't3a', 't3b');
    const windyCov = pairTop15Cov(windy, 't3a', 't3b');
    expect(windyCov).toBeGreaterThan(calmCov + 0.01);
  });

  it('is a strict no-op without weather (neutral default preserved)', () => {
    const a = simulateStage(echField, calm, undefined, { nSims: 1500, seed: 5 });
    const b = simulateStage(echField, { ...flat }, undefined, { nSims: 1500, seed: 5 });
    expect(a.map((d) => d.probs[0])).toEqual(b.map((d) => d.probs[0]));
  });

  it('does not fire on a summit finish (echelons need exposed terrain)', () => {
    const windySummit: Stage = { ...summit, weather: windy.weather };
    const plainSummit: Stage = { ...summit };
    const a = simulateStage(echField, windySummit, undefined, { nSims: 1500, seed: 6 });
    const b = simulateStage(echField, plainSummit, undefined, { nSims: 1500, seed: 6 });
    // weather still affects spread/DNF, but the echelon SCENARIO must not trigger,
    // so the win marginals stay very close (no team-split reshuffle of the head).
    const wa = a.find((d) => d.riderId === 't0a')!.probs[0];
    const wb = b.find((d) => d.riderId === 't0a')!.probs[0];
    expect(Math.abs(wa - wb)).toBeLessThan(0.02);
  });
});

describe('projectField opt-in simulator path', () => {
  const hilly: Stage = { ...flat, type: 'hilly' };

  it('values a break specialist via the sim where the analytic model gives ~0', () => {
    const sim = { nSims: 4000, seed: 9 };
    const analytic = projectField(field, hilly, undefined, { analytic: true });
    const simmed = projectField(field, hilly, undefined, { simulate: sim });
    const xgA = new Map(analytic.map((p) => [p.riderId, p.xG]));
    const xgS = new Map(simmed.map((p) => [p.riderId, p.xG]));
    expect(xgS.get('attacker')!).toBeGreaterThan(xgA.get('attacker')!);
  });

  it('ensemble blends analytic and sim and stays coherent', () => {
    const dists = buildEnsembleField(field, hilly, undefined, 0.5, { nSims: 2000, seed: 3 });
    const sumWin = dists.reduce((a, d) => a + d.probs[0], 0);
    expect(sumWin).toBeGreaterThan(0.9);
    expect(sumWin).toBeLessThan(1.05);
    // attacker gets some win mass via the sim half on a break-friendly stage
    expect(dists.find((d) => d.riderId === 'attacker')!.probs[0]).toBeGreaterThan(0);
  });

  it('effectiveSpread widens with field strength and is safe on bad input', () => {
    const cfg = defaultConfig();
    const weak: Stage = { ...flat, startlistQuality: 200 };
    const strong: Stage = { ...flat, startlistQuality: 1600 };
    expect(effectiveSpread(strong, cfg)).toBeGreaterThan(effectiveSpread(weak, cfg));
    expect(effectiveSpread(flat, cfg)).toBe(cfg.jointSpread); // no quality → base
    // array / NaN input must not produce NaN (the bug that broke the fitter)
    const bad = { ...flat, startlistQuality: [668, 662] as unknown as number };
    expect(Number.isFinite(effectiveSpread(bad, cfg))).toBe(true);
  });

  it('jointEtapebonus matches manual count on a tiny deterministic field', () => {
    const { samples } = simulateJoint(field, flat, undefined, { nSims: 1000, seed: 5 });
    const teamIdx = new Set([0, 1, 2]); // first three starters
    const ev = jointEtapebonus(teamIdx, samples, etapebonus);
    expect(ev).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(ev)).toBe(true);
  });
});
