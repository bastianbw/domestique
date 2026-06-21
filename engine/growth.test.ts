import { describe, it, expect } from 'vitest';
import { projectField } from './growth';
import { buildField } from './probability';
import type { Rider } from './types';
import { getStage } from './stages';

function rider(partial: Partial<Rider> & Pick<Rider, 'id' | 'archetype'>): Rider {
  return {
    name: partial.id, team: 'T', price: 8_000_000,
    form: 70, pcsRank: 30, teamStrength: 60, injury: 'fit',
    breakawayTendency: 20, ...partial,
  } as Rider;
}

const sprinter = rider({ id: 'spr', archetype: 'sprinter', form: 90, pcsRank: 3 });
const climber = rider({ id: 'clm', archetype: 'climber', form: 88, pcsRank: 4 });
const dom = rider({ id: 'dom', archetype: 'domestique', form: 55, pcsRank: 120 });
const field = [sprinter, climber, dom];

describe('finishing distribution', () => {
  it('sums probability mass to 1 (finish + DNF)', () => {
    const flat = getStage(7)!;
    const dists = buildField(field, flat, undefined as any);
    for (const d of dists) {
      const total = d.probs.reduce((a, b) => a + b, 0) + d.pDNF;
      expect(total).toBeCloseTo(1, 4);
    }
  });

  it('favours sprinters on flat stages and climbers on summit stages', () => {
    const flat = getStage(7)!;   // Bordeaux sprint
    const summit = getStage(6)!; // Pyrenean summit

    const flatProj = projectField(field, flat);
    const sprP = flatProj.find((p) => p.riderId === 'spr')!;
    const clmP = flatProj.find((p) => p.riderId === 'clm')!;
    expect(sprP.pWin).toBeGreaterThan(clmP.pWin);

    const summitProj = projectField(field, summit);
    const sprS = summitProj.find((p) => p.riderId === 'spr')!;
    const clmS = summitProj.find((p) => p.riderId === 'clm')!;
    expect(clmS.pWin).toBeGreaterThan(sprS.pWin);
  });
});

describe('captain EV', () => {
  it('doubles positive expected growth', () => {
    const proj = projectField(field, getStage(7)!);
    for (const p of proj) {
      if (p.xG > 0) expect(p.captainEV).toBeCloseTo(p.xG * 2, 4);
    }
  });
});

describe('TTT special-case (stage 1)', () => {
  it('routes growth through the TTT component, not placement', () => {
    const ttt = getStage(1)!;
    const strongTeam = rider({ id: 'str', archetype: 'rouleur', teamStrength: 95 });
    const proj = projectField([strongTeam, sprinter, climber], ttt);
    const strP = proj.find((p) => p.riderId === 'str')!;
    expect(strP.breakdown.ttt).toBeGreaterThan(0);
    expect(strP.breakdown.placement).toBe(0);
  });
});

describe('injury handling', () => {
  it('an "out" rider has ~zero projected growth and no win chance', () => {
    const out = rider({ id: 'out', archetype: 'sprinter', injury: 'out' });
    const proj = projectField([out, sprinter, climber], getStage(7)!);
    const o = proj.find((p) => p.riderId === 'out')!;
    expect(o.pWin).toBe(0);
    expect(Math.abs(o.xG)).toBeLessThan(1);
  });
});
