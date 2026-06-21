import { describe, it, expect } from 'vitest';
import {
  placementGrowth,
  gcGrowth,
  etapebonus,
  tttGrowth,
  holdbonus,
  pointsGrowth,
  lateArrival,
  dnsTotalPenalty,
  applyInterest,
  transferFee,
  captainBonus,
  JERSEY_PAYOUT,
  DNF_PENALTY,
} from './rules';

describe('placement table (§1 Etapeplacering)', () => {
  it('matches the exact table', () => {
    expect(placementGrowth(1)).toBe(200_000);
    expect(placementGrowth(2)).toBe(150_000);
    expect(placementGrowth(3)).toBe(130_000);
    expect(placementGrowth(6)).toBe(100_000);
    expect(placementGrowth(10)).toBe(80_000);
    expect(placementGrowth(11)).toBe(70_000);
    expect(placementGrowth(15)).toBe(15_000);
  });
  it('is zero for 16th and beyond', () => {
    expect(placementGrowth(16)).toBe(0);
    expect(placementGrowth(50)).toBe(0);
  });
});

describe('GC table (Sammenlagt)', () => {
  it('matches the exact table and caps at 10', () => {
    expect(gcGrowth(1)).toBe(100_000);
    expect(gcGrowth(10)).toBe(10_000);
    expect(gcGrowth(11)).toBe(0);
    expect(gcGrowth(undefined)).toBe(0);
  });
});

describe('Etapebonus tiers (team top-15 count → bank, paid once)', () => {
  it('matches every tier', () => {
    expect(etapebonus(1)).toBe(4_000);
    expect(etapebonus(2)).toBe(8_000);
    expect(etapebonus(3)).toBe(15_000);
    expect(etapebonus(4)).toBe(35_000);
    expect(etapebonus(5)).toBe(65_000);
    expect(etapebonus(6)).toBe(120_000);
    expect(etapebonus(7)).toBe(220_000);
    expect(etapebonus(8)).toBe(400_000);
  });
  it('is zero with none in top15 and caps at 8', () => {
    expect(etapebonus(0)).toBe(0);
    expect(etapebonus(9)).toBe(400_000);
  });
});

describe('TTT special-case (Holdtidskørsel placement)', () => {
  it('pays the exact ladder to all active riders on placing teams', () => {
    expect(tttGrowth(1)).toBe(200_000);
    expect(tttGrowth(2)).toBe(150_000);
    expect(tttGrowth(3)).toBe(100_000);
    expect(tttGrowth(4)).toBe(50_000);
    expect(tttGrowth(5)).toBe(25_000);
    expect(tttGrowth(6)).toBe(0);
  });
});

describe('Holdbonus (rider team result)', () => {
  it('pays 60k/30k/20k for 1st/2nd/3rd team', () => {
    expect(holdbonus(1)).toBe(60_000);
    expect(holdbonus(2)).toBe(30_000);
    expect(holdbonus(3)).toBe(20_000);
    expect(holdbonus(4)).toBe(0);
  });
});

describe('sprint & mountain points (3,000 each, negatives allowed)', () => {
  it('multiplies by 3000', () => {
    expect(pointsGrowth(20, 0)).toBe(60_000);
    expect(pointsGrowth(0, 10)).toBe(30_000);
    expect(pointsGrowth(5, 5)).toBe(30_000);
  });
  it('allows negative points → negative growth', () => {
    expect(pointsGrowth(-2, 0)).toBe(-6_000);
  });
});

describe('jersey payouts', () => {
  it('matches the per-day values', () => {
    expect(JERSEY_PAYOUT.yellow).toBe(25_000);
    expect(JERSEY_PAYOUT.green).toBe(25_000);
    expect(JERSEY_PAYOUT.polka).toBe(25_000);
    expect(JERSEY_PAYOUT.white).toBe(15_000);
    expect(JERSEY_PAYOUT.aggressive).toBe(50_000);
  });
});

describe('Sen ankomst (late arrival, −3,000/full min, cap −90,000)', () => {
  it('charges per FULL minute', () => {
    // 4:54 back → 4 full minutes → −12,000 (from the brief example)
    expect(lateArrival(4 * 60 + 54)).toBe(-12_000);
    expect(lateArrival(59)).toBe(0);
    expect(lateArrival(60)).toBe(-3_000);
    expect(lateArrival(0)).toBe(0);
  });
  it('caps at −90,000', () => {
    expect(lateArrival(60 * 60)).toBe(-90_000); // 60 minutes
    expect(lateArrival(120 * 60)).toBe(-90_000);
  });
});

describe('DNF vs DNS', () => {
  it('DNF that stage is −50,000', () => {
    expect(DNF_PENALTY).toBe(-50_000);
  });
  it('DNS charges −100,000 per remaining stage', () => {
    // Abandons on stage 8: −50k that stage (handled separately), then
    // −100k for each of stages 9..21 = 13 stages = −1,300,000.
    expect(dnsTotalPenalty(9, 21)).toBe(-1_300_000);
    // Abandons effective from the last stage: just 1 stage.
    expect(dnsTotalPenalty(21, 21)).toBe(-100_000);
    expect(dnsTotalPenalty(22, 21)).toBe(0);
  });
});

describe('finance', () => {
  it('bank interest is +0.5% per round', () => {
    expect(applyInterest(1_000_000)).toBe(1_005_000);
  });
  it('transfer fee is 1% of bought value', () => {
    expect(transferFee(10_000_000)).toBe(100_000);
  });
  it('captain bonus only counts positive growth', () => {
    expect(captainBonus(80_000)).toBe(80_000);
    expect(captainBonus(-50_000)).toBe(0);
  });
});
