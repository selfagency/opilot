import { describe, expect, it } from 'vitest';
import { mapLegacyContextToNew, mapToolPayload, normalizeThinkingPart } from './agentsy-compat';

describe('agentsy-compat', () => {
  it('maps legacy context object to new context', () => {
    const legacy = { remaining: 'hello world', metadata: { a: 1 } };
    const res = mapLegacyContextToNew(legacy);
    expect(res.content).toBe('hello world');
    expect(res.meta).toEqual({ a: 1 });
  });

  it('maps string context to new context', () => {
    const res = mapLegacyContextToNew('just text');
    expect(res.content).toBe('just text');
  });

  it('mapToolPayload is identity by default', () => {
    const p = { x: 1, y: 'z' };
    expect(mapToolPayload(p)).toEqual(p);
  });

  it('normalizeThinkingPart handles variants', () => {
    expect(normalizeThinkingPart('abc')).toBe('abc');
    expect(normalizeThinkingPart({ text: 't' })).toBe('t');
    expect(normalizeThinkingPart(undefined)).toBe('');
  });
});
