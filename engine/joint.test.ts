import { describe, it, expect } from 'vitest';
import { buildCoherentField, riderSkill, buildField, climbiness, breakSkill, devigShin } from './probability';
import { STAGES_2026 } from './stages';
import type { Rider, Stage } from './types';

function rider(p: Partial<Rider> & { id: string; archetype: Rider['archetype'] }): Rider {
  return {
    name: p.id, team: p.team ?? p.id + '-team', price: 1,
    form: 70, pcsRank: 50, teamStrength: 60, injury: 'fit', breakawayTendency: 0,
    ...p,
  };
}

const flat: Stage = {
  stage: 5, date: 'Jul8', type: 'flat', route: 'x', km: 150, note: '',
  sprintPtsOnOffer: 100, mtnPtsOnOffer: 0,
};
const summit: Stage = { ...flat, stage: 6, type: 'summit', sprintPtsOnOffer: 45, mtnPtsOnOffer: 60 };

const field: Rider[] = [
  rider({ id: 'sprintA', archetype: 'sprinter', pcsRank: 5 }),
  rider({ id: 'sprintB', archetype: 'sprinter', pcsRank: 60 }),
  rider({ id: 'climbA', archetype: 'climber', pcsRank: 8 }),
  rider({ id: 'gcA', archetype: 'gc', pcsRank: 2 }),
  rider({ id: 'dom', archetype: 'domestique', pcsRank: 300 }),
];

describe('coherent-joint field', () => {
  it('produces a coherent joint: each position taken by ~one rider', () => {
    const dists = buildCoherentField(field, flat);
    const M = field.length;
    // column sums ≈ 1 (minus a little DNF mass) for the first M slots
    for (let p = 0; p < M; p++) {
      const col = dists.reduce((a, d) => a + (d.probs[p] ?? 0), 0);
      expect(col).toBeGreaterThan(0.9);
      expect(col).toBeLessThanOrEqual(1.0001);
    }
    // Σ P(win) over the field ≈ 1 (not ~field-size × 0.1 like the old model)
    const sumWin = dists.reduce((a, d) => a + d.probs[0], 0);
    expect(sumWin).toBeGreaterThan(0.9);
    expect(sumWin).toBeLessThan(1.01);
  });

  it('each rider distribution sums to its finishing mass (1 − pDNF)', () => {
    const dists = buildCoherentField(field, flat);
    for (const d of dists) {
      const mass = d.probs.reduce((a, b) => a + b, 0);
      expect(mass).toBeCloseTo(1 - d.pDNF, 5);
    }
  });

  it('orders the head by skill: a top sprinter wins the flat stage', () => {
    const dists = buildCoherentField(field, flat);
    const byId = new Map(dists.map((d) => [d.riderId, d.probs[0]]));
    expect(byId.get('sprintA')!).toBeGreaterThan(byId.get('climbA')!);
    expect(byId.get('sprintA')!).toBeGreaterThan(byId.get('sprintB')!);
  });

  it('stage suitability modulates rank: a climber beats a top sprinter uphill', () => {
    const dists = buildCoherentField(field, summit);
    const byId = new Map(dists.map((d) => [d.riderId, d.probs[0]]));
    expect(byId.get('climbA')!).toBeGreaterThan(byId.get('sprintA')!);
  });

  it('riderSkill zeroes a climber-less sprinter uphill relative to flat', () => {
    const sprinter = field[0];
    expect(riderSkill(sprinter, flat)).toBeGreaterThan(riderSkill(sprinter, summit));
  });

  it('climbiness is −1 without vertical data and rises with vert/km', () => {
    expect(climbiness(flat)).toBe(-1); // no verticalMeters
    const easy: Stage = { ...flat, km: 180, verticalMeters: 180 * 8 }; // ~8 m/km
    const hard: Stage = { ...flat, km: 180, verticalMeters: 180 * 32 }; // ~32 m/km
    expect(climbiness(easy)).toBeCloseTo(0, 2);
    expect(climbiness(hard)).toBeCloseTo(1, 2);
  });

  it('a climby "hilly" stage drops a sprinter and lifts a climber', () => {
    const hilly: Stage = { ...flat, type: 'hilly' };
    const climbyHilly: Stage = { ...hilly, km: 180, verticalMeters: 180 * 30 };
    const sprinter = rider({ id: 's', archetype: 'sprinter', pcsRank: 5 });
    const climber = rider({ id: 'c', archetype: 'climber', pcsRank: 5 });
    expect(riderSkill(sprinter, climbyHilly)).toBeLessThan(riderSkill(sprinter, hilly));
    expect(riderSkill(climber, climbyHilly)).toBeGreaterThan(riderSkill(climber, hilly));
  });

  it('STAGES_2026 carries baked-in route difficulty', () => {
    const queen = STAGES_2026.find((s) => s.stage === 20)!;
    expect(queen.verticalMeters).toBeGreaterThan(5000); // Alpe d'Huez queen stage
    expect(queen.profileScore).toBeGreaterThan(300);
    expect(climbiness(queen)).toBeGreaterThan(0.9);
  });

  it('breakSkill favours break-prone riders over a star who never attacks', () => {
    const hilly: Stage = { ...flat, type: 'hilly' };
    const attacker = rider({ id: 'atk', archetype: 'breakaway', pcsRank: 80, breakawayTendency: 90 });
    const star = rider({ id: 'star', archetype: 'gc', pcsRank: 3, breakawayTendency: 0 });
    expect(breakSkill(attacker, hilly)).toBeGreaterThan(breakSkill(star, hilly));
    // but for the plain bunch result the star is still stronger
    expect(riderSkill(star, hilly)).toBeGreaterThan(riderSkill(attacker, hilly));
  });

  it('devigShin returns probabilities summing to 1 and corrects the longshot', () => {
    const odds = [1.8, 3.5, 5, 9, 15]; // overround book, favourite at 1.8
    const shin = devigShin(odds);
    const sum = shin.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
    // proportional de-vig for comparison
    const implied = odds.map((o) => 1 / o);
    const S = implied.reduce((a, b) => a + b, 0);
    const prop = implied.map((x) => x / S);
    // Shin shaves the longshot below its proportional share (favourite–longshot)
    expect(shin[shin.length - 1]).toBeLessThan(prop[prop.length - 1]);
    expect(shin[0]).toBeGreaterThan(prop[0]); // and lifts the favourite
  });

  it('buildField routes the no-odds field through the coherent model', () => {
    const dists = buildField(field, flat);
    const sumWin = dists.reduce((a, d) => a + d.probs[0], 0);
    expect(sumWin).toBeLessThan(1.01); // coherent, not the old over-counted ~field×0.1
  });
});
