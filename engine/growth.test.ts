import { describe, it, expect } from 'vitest';
import { projectField, devigTeamWinOdds, expectedGcGrowth } from './growth';
import { buildField } from './probability';
import type { Rider, RiderDistribution } from './types';
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

describe('odds are not re-flattened by the no-odds calibration', () => {
  it('projectField keeps a fully-priced pWin at the de-vigged market number', () => {
    // γ=0.85 is fitted on the NO-ODDS corpus; applying it to a market-anchored
    // field crushed pasted favourites (~30% → ~18%) — the "xG is really low"
    // symptom. A clean uniform book (12 riders at win 12.0, zero overround)
    // must project pWin = exactly the implied 1/12.
    const flat = getStage(7)!;
    const priced = Array.from({ length: 12 }, (_, i) =>
      rider({ id: `r${i}`, archetype: 'sprinter', oddsByStage: { 7: { win: 12.0 } } }),
    );
    const proj = projectField(priced, flat);
    for (const p of proj) {
      expect(Math.abs(p.pWin - 1 / 12)).toBeLessThan(0.005);
    }
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

describe('expectedGcGrowth — projected GC shift on GC-relevant terrain', () => {
  const summit = getStage(6)!; // summit finish
  const flat = getStage(7)!;

  // A tiny distribution helper: nearly all mass on finishing position `winAt`.
  function distAt(id: string, winAt: number, n = 20): RiderDistribution {
    const probs = new Array(n).fill(0);
    probs[winAt - 1] = 0.9;
    return { riderId: id, probs, pDNF: 0.02 };
  }

  it('is identical to the static lookup off GC-relevant terrain (flat)', () => {
    const strong = rider({ id: 'a', archetype: 'gc', gcPosition: 2 });
    const weak = rider({ id: 'b', archetype: 'gc', gcPosition: 12 });
    const byId = new Map([[strong.id, distAt('a', 1)], [weak.id, distAt('b', 20)]]);
    const out = expectedGcGrowth([strong, weak], flat, byId);
    expect(out.get('a')).toBe(90_000); // GC_TABLE[2]
    expect(out.get('b')).toBe(0); // GC_TABLE has no entry beyond 10
  });

  it('a currently-out-of-the-money rider projected to ride away from the cohort gets real expected GC value', () => {
    // "Carapaz currently 12th, but climbing away from the group today."
    const climbingAway = rider({ id: 'riding-away', archetype: 'climber', gcPosition: 12 });
    const restOfCohort = ['c1', 'c2', 'c3', 'c4'].map((id, i) =>
      rider({ id, archetype: 'gc', gcPosition: i + 1 }),
    );
    const byId = new Map<string, RiderDistribution>([
      ['riding-away', distAt('riding-away', 1)], // best projected performer today
      ...restOfCohort.map((r, i) => [r.id, distAt(r.id, i + 10)] as const), // mid-pack today
    ]);
    const out = expectedGcGrowth([climbingAway, ...restOfCohort], summit, byId);
    expect(out.get('riding-away')!).toBeGreaterThan(0); // was a hard 0 under the static lookup
  });

  it('a strong current leader projected to fade regresses below the static lookup', () => {
    const fading = rider({ id: 'fading', archetype: 'gc', gcPosition: 1 });
    const strong = ['s1', 's2', 's3', 's4'].map((id, i) =>
      rider({ id, archetype: 'gc', gcPosition: i + 6 }),
    );
    const byId = new Map<string, RiderDistribution>([
      ['fading', distAt('fading', 20)], // worst projected performer today
      ...strong.map((r, i) => [r.id, distAt(r.id, i + 1)] as const),
    ]);
    const out = expectedGcGrowth([fading, ...strong], summit, byId);
    expect(out.get('fading')!).toBeLessThan(100_000); // GC_TABLE[1], the static value
  });

  it('wires into projectField end-to-end: a strong projected performer just outside the top 10 gets nonzero GC xG on a summit finish', () => {
    const contender = rider({ id: 'contender', archetype: 'climber', gcPosition: 11, pcsRank: 5, form: 92 });
    const others = Array.from({ length: 14 }, (_, i) =>
      rider({ id: `gc${i}`, archetype: 'gc', gcPosition: i < 10 ? i + 1 : undefined, pcsRank: 40 + i, form: 60 }),
    );
    const proj = projectField([contender, ...others], summit);
    const c = proj.find((p) => p.riderId === 'contender')!;
    expect(c.breakdown.gc).toBeGreaterThan(0);
  });
});
