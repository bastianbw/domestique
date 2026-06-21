import { describe, it, expect } from 'vitest';
import { computeStageGrowth, applyToTeam, rollPrice } from './resultLogger';
import { parseImportBlock, matchRider, parsePrice, normalizeName } from './importSchema';
import type { Rider, StageResultBlock } from './types';
import { getStage } from './stages';

function rider(id: string, name: string, team: string, partial: Partial<Rider> = {}): Rider {
  return {
    id, name, team, archetype: 'sprinter', price: 8_000_000,
    form: 70, pcsRank: 20, teamStrength: 60, injury: 'fit',
    breakawayTendency: 10, ...partial,
  };
}

const roster: Rider[] = [
  rider('phil', 'Jasper Philipsen', 'Alpecin'),
  rider('milan', 'Jonathan Milan', 'Lidl-Trek'),
  rider('pog', 'Tadej Pogacar', 'UAE', { archetype: 'gc' }),
  rider('vine', 'Sepp Kuss', 'Visma', { archetype: 'climber' }),
];

describe('computeStageGrowth — flat sprint result', () => {
  const block: StageResultBlock = {
    type: 'stageResult',
    stage: 7,
    results: [
      { rider: 'Jasper Philipsen', pos: 1, sprintPts: 20, mtnPts: 0, gap: 0 },
      { rider: 'Jonathan Milan', pos: 2, sprintPts: 17, mtnPts: 0, gap: 0 },
      { rider: 'Tadej Pogacar', pos: 30, gap: 0, gcPos: 1 },
      { rider: 'Sepp Kuss', pos: 80, gap: 5 * 60 + 10 }, // 5:10 down → 5 min late
    ],
    jerseys: { yellow: 'Tadej Pogacar', green: 'Jasper Philipsen' },
    teamResultTop3: ['Alpecin', 'Lidl-Trek', 'Visma'],
  };

  const res = computeStageGrowth(block, roster, getStage(7)!);

  it('winner gets placement + points + green jersey + holdbonus (team 1st)', () => {
    const g = res.byRider['phil'];
    // 200,000 placement + 20*3000 sprint + 25,000 green + 60,000 holdbonus
    expect(g.breakdown.placement).toBe(200_000);
    expect(g.breakdown.sprintMtn).toBe(60_000);
    expect(g.breakdown.jerseys).toBe(25_000);
    expect(g.breakdown.holdbonus).toBe(60_000);
    expect(g.growth).toBe(345_000);
  });

  it('GC leader gets the Sammenlagt 1st bonus and yellow jersey', () => {
    const g = res.byRider['pog'];
    expect(g.breakdown.gc).toBe(100_000);
    expect(g.breakdown.jerseys).toBe(25_000); // yellow
    expect(g.breakdown.placement).toBe(0); // 30th pays nothing
  });

  it('applies late-arrival penalty per full minute', () => {
    const g = res.byRider['vine'];
    expect(g.breakdown.lateArrival).toBe(-15_000); // 5 full minutes × −3,000
  });

  it('reports no unmatched names', () => {
    expect(res.unmatched.length).toBe(0);
  });
});

describe('computeStageGrowth — DNF and DNS', () => {
  it('DNF gets −50k this stage but keeps earned points, no holdbonus', () => {
    const block: StageResultBlock = {
      type: 'stageResult', stage: 8,
      results: [{ rider: 'Jasper Philipsen', pos: 50, sprintPts: 2, mtnPts: 0 }],
      dnf: ['Jasper Philipsen'],
    };
    const res = computeStageGrowth(block, roster, getStage(8)!);
    const g = res.byRider['phil'];
    expect(g.breakdown.dnfRisk).toBe(-50_000);
    expect(g.breakdown.sprintMtn).toBe(6_000); // points still earned
    expect(g.breakdown.holdbonus).toBe(0);
    expect(g.finished).toBe(false);
  });

  it('previously-abandoned rider takes −100k for a not-started stage', () => {
    const block: StageResultBlock = {
      type: 'stageResult', stage: 9,
      results: [{ rider: 'Jonathan Milan', pos: 1 }],
    };
    const res = computeStageGrowth(block, roster, getStage(9)!, {
      alreadyAbandoned: new Set(['phil']),
    });
    expect(res.byRider['phil'].growth).toBe(-100_000);
  });
});

describe('computeStageGrowth — TTT special-case (stage 1)', () => {
  it('pays Holdtidskørsel ladder, not placement', () => {
    const block: StageResultBlock = {
      type: 'stageResult', stage: 1, isTTT: true,
      results: [
        { rider: 'Tadej Pogacar', pos: 1 },
        { rider: 'Jasper Philipsen', pos: 9 },
      ],
      tttTeamOrder: ['UAE', 'Alpecin'],
    };
    const res = computeStageGrowth(block, roster, getStage(1)!);
    expect(res.byRider['pog'].breakdown.ttt).toBe(200_000); // UAE 1st
    expect(res.byRider['pog'].breakdown.placement).toBe(0);
    expect(res.byRider['phil'].breakdown.ttt).toBe(150_000); // Alpecin 2nd
  });
});

describe('applyToTeam — bank update', () => {
  it('adds captain bonus, Etapebonus and 0.5% interest', () => {
    const block: StageResultBlock = {
      type: 'stageResult', stage: 7,
      results: [
        { rider: 'Jasper Philipsen', pos: 1, sprintPts: 20 },
        { rider: 'Jonathan Milan', pos: 2, sprintPts: 17 },
      ],
      teamResultTop3: ['Alpecin'],
    };
    const growth = computeStageGrowth(block, roster, getStage(7)!);
    const owned = ['phil', 'milan'];
    const bank = 1_000_000;
    const upd = applyToTeam(growth, owned, 'phil', bank, block.results, roster);

    // 2 owned in top-15 → Etapebonus tier 2 = 8,000
    expect(upd.etapebonus).toBe(8_000);
    // captain = phil, positive growth paid again
    expect(upd.captainBonus).toBe(growth.byRider['phil'].growth);
    expect(upd.interest).toBe(5_000);
    expect(upd.newBank).toBe(1_005_000 + upd.captainBonus + 8_000);
  });
});

describe('rollPrice', () => {
  it('rolls value forward by growth, or trusts an explicit newPrice', () => {
    expect(rollPrice(8_000_000, 200_000)).toBe(8_200_000);
    expect(rollPrice(8_000_000, 200_000, 8_500_000)).toBe(8_500_000);
    expect(rollPrice(100_000, -200_000)).toBe(0); // never negative
  });
});

describe('import parsing & name matching', () => {
  it('parses a valid stageResult block', () => {
    const r = parseImportBlock('{"type":"stageResult","stage":7,"results":[{"rider":"X","pos":1}]}');
    expect(r.ok).toBe(true);
  });
  it('rejects malformed JSON with a helpful error', () => {
    const r = parseImportBlock('not json');
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/JSON/);
  });
  it('matches accented/variant spellings', () => {
    expect(matchRider('Tadej Pogačar', roster).riderId).toBe('pog');
    expect(matchRider('J. Philipsen', roster).riderId).toBe('phil');
    expect(normalizeName('Pogačar')).toBe('pogacar');
  });
  it('matches PCS "Lastname Firstname" order', () => {
    // ProCyclingStats lists names surname-first; matching must be order-insensitive.
    expect(matchRider('Pogačar Tadej', roster).riderId).toBe('pog');
    expect(matchRider('Philipsen Jasper', roster).riderId).toBe('phil');
  });
  it('reports an unmatched name rather than guessing wildly', () => {
    expect(matchRider('Completely Different Person', roster).riderId).toBeNull();
  });
  it('parses prices in several formats', () => {
    expect(parsePrice('9.5M')).toBe(9_500_000);
    expect(parsePrice('9,5M')).toBe(9_500_000);
    expect(parsePrice('9500000')).toBe(9_500_000);
    expect(parsePrice('9.5')).toBe(9_500_000);
  });
});
