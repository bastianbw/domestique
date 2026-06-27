import { describe, it, expect } from 'vitest';
import { parseImportBlock, validateBlock } from './importSchema';

describe('validateBlock — block types', () => {
  it('accepts a weather block', () => {
    const r = validateBlock({ type: 'weather', stage: 8, windKph: 40, rainProb: 70 });
    expect(r.ok).toBe(true);
    expect(r.block?.type).toBe('weather');
  });

  it('accepts a news block and rejects one without items', () => {
    expect(validateBlock({ type: 'news', items: [{ rider: 'X', formDelta: 5 }] }).ok).toBe(true);
    expect(validateBlock({ type: 'news' }).ok).toBe(false);
  });

  it('rejects a weather block with no numeric stage', () => {
    expect(validateBlock({ type: 'weather' }).ok).toBe(false);
  });

  it('rejects an unknown type with a helpful message', () => {
    const r = validateBlock({ type: 'banana' });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/weather \| news/);
  });

  it('accepts a PCS features block and rejects one without riders', () => {
    const ok = validateBlock({
      type: 'features',
      asOf: '2026-07-01',
      riders: [{ rider: 'Tadej Pogacar', pcsRank: 1, terrainAffinity: { summit: 1.3 } }],
    });
    expect(ok.ok).toBe(true);
    expect(ok.block?.type).toBe('features');
    expect(validateBlock({ type: 'features' }).ok).toBe(false);
    expect(validateBlock({ type: 'features', riders: [{ pcsRank: 1 }] }).ok).toBe(false);
  });
});

describe('parseImportBlock + array elements', () => {
  it('parses a single pasted block via JSON', () => {
    const r = parseImportBlock('{"type":"odds","stage":5,"odds":[]}');
    expect(r.ok).toBe(true);
  });

  it('each element of a published [result, weather] array validates independently', () => {
    const bundle = [
      { type: 'stageResult', stage: 7, results: [{ rider: 'A', pos: 1 }] },
      { type: 'weather', stage: 8, windKph: 35, gustRisk: 'high' },
    ];
    const parsed = bundle.map((b) => validateBlock(b));
    expect(parsed.every((p) => p.ok)).toBe(true);
    expect(parsed.map((p) => p.block?.type)).toEqual(['stageResult', 'weather']);
  });
});
