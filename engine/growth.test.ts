import { describe, it, expect } from 'vitest';
import { projectField, devigTeamWinOdds } from './growth';
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

describe('odds-aware default', () => {
  it('projectField default uses pasted odds (does not throw the market away)', () => {
    const flat = getStage(7)!;
    // 6 priced riders (real overround) + filler with no odds.
    const winOdds = [3, 4, 6, 8, 10, 12];
    const priced = winOdds.map((w, i) => rider({ id: `p${i}`, archetype: 'sprinter', pcsRank: 20 + i, oddsByStage: { 7: { win: w } } }));
    const filler = Array.from({ length: 8 }, (_, i) => rider({ id: `f${i}`, archetype: 'domestique', pcsRank: 120 + i }));
    const field = [...priced, ...filler];

    const withOdds = projectField(field, flat); // default → odds-aware
    const noOdds = projectField(field.map((r) => ({ ...r, oddsByStage: undefined })), flat); // default → ensemble

    const favWith = withOdds.find((p) => p.riderId === 'p0')!; // win odd 3.0 = the favourite
    const favNo = noOdds.find((p) => p.riderId === 'p0')!;
    const longWith = withOdds.find((p) => p.riderId === 'p5')!; // win odd 12.0 = longshot

    // The market favourite's win prob must rise once odds are present (the
    // regression was the default IGNORING odds — pWin identical with/without).
    expect(favWith.pWin).toBeGreaterThan(0.2);
    expect(favWith.pWin).toBeGreaterThan(favNo.pWin + 0.1);
    // And the market must separate the favourite from the longshot.
    expect(favWith.pWin).toBeGreaterThan(longWith.pWin + 0.1);
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

  it('devigTeamWinOdds collapses one entry per team (not per rider) before de-vigging', () => {
    const ttt = getStage(1)!;
    const a1 = rider({ id: 'a1', archetype: 'rouleur', team: 'A' });
    const a2 = rider({ id: 'a2', archetype: 'rouleur', team: 'A' });
    const b1 = rider({ id: 'b1', archetype: 'rouleur', team: 'B' });
    const withOdds = [a1, a2, b1].map((r) => ({
      ...r,
      oddsByStage: { [ttt.stage]: { win: r.team === 'A' ? 1.8 : 4.0 } },
    }));
    const probs = devigTeamWinOdds(withOdds, ttt.stage);
    expect(probs.size).toBe(2); // one entry per TEAM, not per rider
    expect(probs.get('A')!).toBeGreaterThan(probs.get('B')!);
    const total = [...probs.values()].reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 4); // de-vigged
  });

  it('pasted team WIN odds (fanned onto every rider on that team) move a TTT favourite up and a longshot down', () => {
    const ttt = getStage(1)!;
    const teamA = rider({ id: 'a1', archetype: 'rouleur', team: 'A', teamStrength: 90 });
    const teamB = rider({ id: 'b1', archetype: 'rouleur', team: 'B', teamStrength: 90 });

    const noOdds = projectField([teamA, teamB], ttt);
    const beforeA = noOdds.find((p) => p.riderId === 'a1')!.breakdown.ttt;
    const beforeB = noOdds.find((p) => p.riderId === 'b1')!.breakdown.ttt;
    expect(beforeA).toBeCloseTo(beforeB, 4); // identical team strength → identical structural estimate

    const withOdds = [
      { ...teamA, oddsByStage: { [ttt.stage]: { win: 1.4 } } }, // heavy favourite
      { ...teamB, oddsByStage: { [ttt.stage]: { win: 9.0 } } }, // longshot
    ];
    const proj = projectField(withOdds, ttt);
    const afterA = proj.find((p) => p.riderId === 'a1')!.breakdown.ttt;
    const afterB = proj.find((p) => p.riderId === 'b1')!.breakdown.ttt;
    expect(afterA).toBeGreaterThan(beforeA);
    expect(afterB).toBeLessThan(beforeB);
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
