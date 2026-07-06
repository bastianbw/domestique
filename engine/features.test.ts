import { describe, it, expect } from 'vitest';
import { computeTerrainAffinity } from './features';

describe('computeTerrainAffinity — race-strength weighting', () => {
  // A rider whose only mountain results are a string of top-10s: identical
  // ranks, only the race's startlist quality (level) differs.
  const strongRanks = [3, 4, 6, 8, 10, 16]; // e.g. Piganzoli's Giro run
  const flatFiller = Array.from({ length: 6 }, () => ({ type: 'flat' as const, rank: 60, level: 700 }));

  function mountainResults(level: number) {
    return strongRanks.map((rank) => ({ type: 'high_mtn' as const, rank, level }));
  }

  it('the SAME finishes at Tour-level depth (SQ~1700) earn a higher mountain multiplier than at Giro-level depth (SQ~950)', () => {
    const atGiro = computeTerrainAffinity([...mountainResults(955), ...flatFiller]);
    const atTour = computeTerrainAffinity([...mountainResults(1711), ...flatFiller]);
    expect(atTour.high_mtn).toBeGreaterThan(atGiro.high_mtn!);
  });

  it('a weaker (smaller) race shrinks the multiplier further toward neutral (1) than an equally-sized strong one', () => {
    const atWeakRace = computeTerrainAffinity([...mountainResults(500), ...flatFiller]);
    const atTour = computeTerrainAffinity([...mountainResults(1711), ...flatFiller]);
    // Both are genuinely good results, so both lift above 1 — but the weak-field
    // version should sit closer to neutral, not earn the same trust.
    expect(atWeakRace.high_mtn).toBeGreaterThan(1);
    expect(atWeakRace.high_mtn!).toBeLessThan(atTour.high_mtn!);
  });

  it('missing level data falls back to a neutral mid-weight (behaviour is unchanged, not zeroed out)', () => {
    const noLevel = mountainResults(0).map(({ type, rank }) => ({ type, rank })); // level omitted
    const out = computeTerrainAffinity([...noLevel, ...flatFiller]);
    expect(out.high_mtn).toBeGreaterThan(1); // still recognises the strong finishes
  });
});
