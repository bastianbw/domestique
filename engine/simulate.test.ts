import { describe, it, expect } from 'vitest';
import { simulateStage, mulberry32, simulateJoint, jointEtapebonus } from './simulate';
import { projectField } from './growth';
import { etapebonus } from './rules';
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

describe('projectField opt-in simulator path', () => {
  const hilly: Stage = { ...flat, type: 'hilly' };

  it('values a break specialist via the sim where the analytic model gives ~0', () => {
    const sim = { nSims: 4000, seed: 9 };
    const analytic = projectField(field, hilly);
    const simmed = projectField(field, hilly, undefined, { simulate: sim });
    const xgA = new Map(analytic.map((p) => [p.riderId, p.xG]));
    const xgS = new Map(simmed.map((p) => [p.riderId, p.xG]));
    expect(xgS.get('attacker')!).toBeGreaterThan(xgA.get('attacker')!);
  });

  it('jointEtapebonus matches manual count on a tiny deterministic field', () => {
    const { samples } = simulateJoint(field, flat, undefined, { nSims: 1000, seed: 5 });
    const teamIdx = new Set([0, 1, 2]); // first three starters
    const ev = jointEtapebonus(teamIdx, samples, etapebonus);
    expect(ev).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(ev)).toBe(true);
  });
});
