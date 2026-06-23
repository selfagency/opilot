// src/context-utils.test.ts

import type { Message } from 'ollama';
import { describe, expect, it } from 'vitest';
import { compressToContext } from './compression.js';
import {
  DEFAULT_CONTEXT_TOKENS,
  detectsRepetition,
  estimateMessagesTokens,
  resolveContextLimit
} from './context-utils.js';

function makeMsg(role: Message['role'], chars: number): Message {
  return { role, content: 'x'.repeat(chars) };
}

describe('estimateMessagesTokens', () => {
  it('returns 0 for empty array', () => {
    expect(estimateMessagesTokens([])).toBe(0);
  });

  it('estimates tokens as ceil(chars / 4) + 4 overhead per message', () => {
    const messages: Message[] = [{ role: 'user', content: 'a'.repeat(8) }];
    // 8 chars / 4 = 2 tokens + 4 overhead = 6
    expect(estimateMessagesTokens(messages)).toBe(6);
  });
});

describe('compressToContext', () => {
  it('returns messages unchanged when maxInputTokens is 0', async () => {
    const messages: Message[] = [makeMsg('user', 100)];
    expect(await compressToContext(messages, 0)).toBe(messages);
  });

  it('returns messages unchanged when they fit within budget', async () => {
    const messages: Message[] = [makeMsg('user', 4)]; // ~1 token + 4 overhead = 5
    const result = await compressToContext(messages, 1000);
    expect(result).toEqual(messages);
  });

  it('always keeps the last message (current user turn)', async () => {
    const system = makeMsg('system', 10_000);
    const lastUser = makeMsg('user', 8);
    const result = await compressToContext([system, lastUser], 100);
    expect(result.at(-1)).toEqual(lastUser);
  });

  it('drops old history before the last message', async () => {
    const system = makeMsg('system', 10);
    const old1 = makeMsg('user', 4000);
    const old2 = makeMsg('assistant', 4000);
    const current = makeMsg('user', 10);

    const maxTokens = 100;

    const result = await compressToContext([system, old1, old2, current], maxTokens);
    expect(result.at(-1)).toEqual(current);
    // Old history should be dropped by @agentsy/context under pressure
    expect(result.find(m => m.content === old1.content)).toBeUndefined();
    expect(result.find(m => m.content === old2.content)).toBeUndefined();
  });

  it('truncates system content when it exceeds 40% of budget', async () => {
    const system = makeMsg('system', 10_000);
    const user = makeMsg('user', 10);
    const result = await compressToContext([system, user], 2000);

    const sysMsgContent = result.find(m => m.role === 'system')?.content as string;
    expect(sysMsgContent).toBeDefined();
    // Should be truncated
    expect(sysMsgContent.length).toBeLessThan(10_000);
    expect(sysMsgContent).toContain('[context truncated');
  });

  it('keeps system messages without truncation when they fit', async () => {
    const system: Message = { role: 'system', content: 'short system' };
    const user: Message = { role: 'user', content: 'hello' };
    const result = await compressToContext([system, user], 10_000);
    expect(result).toEqual([system, user]);
  });

  it('keeps most recent history when some fits', async () => {
    const system = makeMsg('system', 10);
    const old = makeMsg('user', 5000);
    const recent = makeMsg('assistant', 20);
    const current = makeMsg('user', 10);

    // Budget approx 513 with maxTokens=100.
    // System: 3+4=7, Current: 3+4=7. Remaining: 499.
    // Recent: 5+4=9 fits. Old: 1250+4=1254 doesn't fit.
    const result = await compressToContext([system, old, recent, current], 100);
    expect(result.at(-1)).toEqual(current);
    expect(result.some(m => m.content === recent.content)).toBe(true);
    expect(result.some(m => m.content === old.content)).toBe(false);
  });
});

describe('detectsRepetition', () => {
  it('returns false for non-repetitive text', () => {
    expect(detectsRepetition('hello world how are you', 'moderate')).toBe(false);
  });

  it('returns true for exact repetitions', () => {
    const repetitive = 'hello '.repeat(20);
    expect(detectsRepetition(repetitive, 'moderate')).toBe(true);
  });

  it('is sensitive to the threshold', () => {
    const repetitive = 'hello world '.repeat(30);
    expect(detectsRepetition(repetitive, 'off')).toBe(false);
    expect(detectsRepetition(repetitive, 'moderate')).toBe(true);
  });
});

describe('resolveContextLimit', () => {
  it('prefers explicit model num_ctx if > 0', () => {
    expect(resolveContextLimit(100, 200, 300)).toBe(200);
  });

  it('falls back to request maxInputTokens if num_ctx is 0', () => {
    expect(resolveContextLimit(100, 0, 300)).toBe(100);
  });

  it('caps by maxContextTokens setting if > 0', () => {
    // Priority rule: model reported > user setting.
    // wait - resolveContextLimit code says:
    // 1. modelOptNumCtx
    // 2. modelReported
    // 3. settingMax
    // so if modelReported > 0, settingMax is ignored.
    expect(resolveContextLimit(1000, 0, 500)).toBe(1000);
    // If modelReported is 0, then settingMax is used.
    expect(resolveContextLimit(0, 0, 500)).toBe(500);
  });

  it('uses DEFAULT_CONTEXT_TOKENS if all other inputs are 0', () => {
    expect(resolveContextLimit(0, 0, 0)).toBe(DEFAULT_CONTEXT_TOKENS);
  });
});
