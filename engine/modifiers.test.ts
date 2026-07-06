import { describe, it, expect } from 'vitest';
import {
  weatherSpreadFactor, weatherDnfFactor, weatherBreakFactor, weatherCrashFactor,
  newsSkillFactor, newsBreakFactor,
} from './modifiers';
import { effectiveSpread, riderDnfRisk, riderSkill, breakSkill } from './probability';
import { projectField } from './growth';
import { defaultConfig } from './config';
import type { Rider, Stage } from './types';

function rider(p: Partial<Rider> & { id: string; archetype: Rider['archetype'] }): Rider {
  return {
    name: p.id, team: p.id + '-team', price: 1,
    form: 70, pcsRank: 50, teamStrength: 60, injury: 'fit', breakawayTendency: 20,
    ...p,
  };
}

const flat: Stage = {
  stage: 5, date: 'Jul8', type: 'flat', route: 'x', km: 150, note: '',
  sprintPtsOnOffer: 100, mtnPtsOnOffer: 0,
};
const cfg = defaultConfig();

describe('modifiers — strict neutral default', () => {
  it('every factor is exactly 1 with no weather/news', () => {
    expect(weatherSpreadFactor(flat)).toBe(1);
    expect(weatherDnfFactor(flat)).toBe(1);
    expect(weatherBreakFactor(flat)).toBe(1);
    expect(weatherCrashFactor(flat)).toBe(1);
    const r = rider({ id: 'r', archetype: 'sprinter' });
    expect(newsSkillFactor(r)).toBe(1);
    expect(newsBreakFactor(r)).toBe(1);
  });

  it('an empty weather/news object is also neutral', () => {
    expect(weatherSpreadFactor({ ...flat, weather: {} })).toBe(1);
    expect(weatherDnfFactor({ ...flat, weather: {} })).toBe(1);
    expect(newsSkillFactor(rider({ id: 'r', archetype: 'gc', news: {} }))).toBe(1);
    expect(newsBreakFactor(rider({ id: 'r', archetype: 'gc', news: {} }))).toBe(1);
  });

  it('projectField output is bit-identical with no weather/news (validated base untouched)', () => {
    const field = [
      rider({ id: 'a', archetype: 'sprinter', pcsRank: 4 }),
      rider({ id: 'b', archetype: 'gc', pcsRank: 2 }),
      rider({ id: 'c', archetype: 'climber', pcsRank: 9 }),
    ];
    const base = projectField(field, flat, cfg);
    const again = projectField(field.map((r) => ({ ...r })), { ...flat }, cfg);
    expect(again.map((p) => p.xG)).toEqual(base.map((p) => p.xG));
  });
});

describe('weather modifiers — correct direction', () => {
  it('cross-winds / gusts widen the spread', () => {
    const windy: Stage = { ...flat, weather: { crosswindSections: 4, gustRisk: 'high', windKph: 45 } };
    expect(weatherSpreadFactor(windy)).toBeGreaterThan(1);
    expect(effectiveSpread(windy, cfg)).toBeGreaterThan(effectiveSpread(flat, cfg));
  });

  it('rain raises DNF risk', () => {
    const r = rider({ id: 'r', archetype: 'sprinter' });
    const wet: Stage = { ...flat, weather: { rainProb: 80, tempC: 5 } };
    expect(weatherDnfFactor(wet)).toBeGreaterThan(1);
    expect(riderDnfRisk(r, wet, cfg)).toBeGreaterThan(riderDnfRisk(r, flat, cfg));
  });

  it('rain nudges the break-success factor up', () => {
    expect(weatherBreakFactor({ ...flat, weather: { rainProb: 90 } })).toBeGreaterThan(1);
  });

  it('rain raises the crash factor (wet roads → real pileup risk)', () => {
    expect(weatherCrashFactor({ ...flat, weather: { rainProb: 85 } })).toBeGreaterThan(1);
  });
});

describe('news modifiers — correct direction', () => {
  it('a positive form nudge lifts skill, a "saving" motivation dampens it', () => {
    const base = rider({ id: 'r', archetype: 'puncheur', pcsRank: 20 });
    const hot = rider({ id: 'r', archetype: 'puncheur', pcsRank: 20, news: { formDelta: 25, motivation: 'home roads' } });
    const cold = rider({ id: 'r', archetype: 'puncheur', pcsRank: 20, news: { motivation: 'saving for the mountains' } });
    expect(newsSkillFactor(hot)).toBeGreaterThan(1);
    expect(newsSkillFactor(cold)).toBeLessThan(1);
    expect(riderSkill(hot, flat, cfg)).toBeGreaterThan(riderSkill(base, flat, cfg));
    expect(riderSkill(cold, flat, cfg)).toBeLessThan(riderSkill(base, flat, cfg));
  });

  it('a stated breakaway intent raises break propensity', () => {
    const base = rider({ id: 'r', archetype: 'rouleur', pcsRank: 60, breakawayTendency: 30 });
    const attack = rider({ id: 'r', archetype: 'rouleur', pcsRank: 60, breakawayTendency: 30, news: { intent: 'breakaway' } });
    expect(newsBreakFactor(attack)).toBeGreaterThan(1);
    expect(breakSkill(attack, flat, cfg)).toBeGreaterThan(breakSkill(base, flat, cfg));
  });

  it('a positive form nudge raises a rider’s projected xG', () => {
    const field = [
      rider({ id: 'hot', archetype: 'sprinter', pcsRank: 8, news: { formDelta: 25 } }),
      rider({ id: 'cold', archetype: 'sprinter', pcsRank: 8 }),
      rider({ id: 'gc', archetype: 'gc', pcsRank: 2 }),
    ];
    const proj = projectField(field, flat, cfg);
    const hot = proj.find((p) => p.riderId === 'hot')!;
    const cold = proj.find((p) => p.riderId === 'cold')!;
    expect(hot.xG).toBeGreaterThan(cold.xG);
  });
});
