// src/contextUtils.test.ts

import { describe, expect, it } from 'vitest';
import type { Message } from 'ollama';
import { truncateMessages, estimateMessagesTokens } from './contextUtils.js';

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

describe('truncateMessages', () => {
  it('returns messages unchanged when maxInputTokens is 0', () => {
    const messages: Message[] = [makeMsg('user', 100)];
    expect(truncateMessages(messages, 0)).toBe(messages);
  });

  it('returns messages unchanged when they fit within budget', () => {
    const messages: Message[] = [makeMsg('user', 4)]; // ~1 token + 4 overhead = 5
    const result = truncateMessages(messages, 1000);
    expect(result).toEqual(messages);
  });

  it('always keeps the last message (current user turn)', () => {
    // System: 10000 chars (~2500 tokens), last user msg: 8 chars (~2 tokens)
    // Budget with maxInputTokens=100 = 100 - 512 clamped to at least 513 = 513
    // Wait - with maxInputTokens=100, budget = max(513, 100-512) = max(513, -412) = 513
    // Actually budget = max(OUTPUT_TOKEN_RESERVE+1, maxInputTokens - OUTPUT_TOKEN_RESERVE)
    // = max(513, 100 - 512) = 513
    // With budget 513: system cap = floor(513 * 0.4) = 205 tokens = 820 chars
    // Last user msg = 2+4 = 6 tokens
    // Even with a tiny budget the last message must always appear
    const system = makeMsg('system', 10000);
    const lastUser = makeMsg('user', 8);
    const result = truncateMessages([system, lastUser], 100);
    expect(result[result.length - 1]).toEqual(lastUser);
  });

  it('drops old history before the last message', () => {
    // Fill history with large messages, small last user msg
    const system = makeMsg('system', 10);
    const old1 = makeMsg('user', 4000);
    const old2 = makeMsg('assistant', 4000);
    const current = makeMsg('user', 10);

    // Use a budget just big enough for system + current but not history
    const maxTokens = 100;

    const result = truncateMessages([system, old1, old2, current], maxTokens);
    expect(result[result.length - 1]).toEqual(current);
    // Old history should be dropped
    expect(result.some(m => m === old1 || m === old2)).toBe(false);
  });

  it('truncates system content when it exceeds 40% of budget', () => {
    // maxInputTokens = 2000, budget = max(513, 2000-512) = 1488
    // systemBudget = floor(1488 * 0.4) = 595 tokens = 2380 chars
    // system: 10000 chars = ~2504 tokens > budget AND > systemBudget → truncated
    const system = makeMsg('system', 10000);
    const user = makeMsg('user', 10);
    const result = truncateMessages([system, user], 2000);

    const sysMsgContent = result.find(m => m.role === 'system')?.content as string;
    expect(sysMsgContent).toBeDefined();
    // Should be truncated
    expect(sysMsgContent.length).toBeLessThan(10000);
    expect(sysMsgContent).toContain('[context truncated');
  });

  it('keeps system messages without truncation when they fit', () => {
    const system: Message = { role: 'system', content: 'short system' };
    const user: Message = { role: 'user', content: 'hello' };
    const result = truncateMessages([system, user], 10000);
    expect(result).toEqual([system, user]);
  });

  it('keeps most recent history when some fits', () => {
    const system = makeMsg('system', 10);
    const old = makeMsg('user', 5000); // ~1250 tokens — won't fit
    const recent = makeMsg('assistant', 20); // ~5 tokens — fits
    const current = makeMsg('user', 10);

    // maxInputTokens = 200, budget = 200 - 512 clamped = max(513, -312) = 513... wait
    // Actually with maxInputTokens=200: budget = max(513, 200-512) = 513
    // systemBudget = floor(513 * 0.4) = 205 tokens = 820 chars (system=10 chars fits)
    // effectiveSystemTokens = ceil(10/4)+4 = 3+4 = 7
    // lastMsgTokens = ceil(10/4)+4 = 3+4 = 7
    // historyBudget = 513 - 7 - 7 = 499
    // recent = ceil(20/4)+4 = 5+4 = 9 tokens — fits
    // old = ceil(5000/4)+4 = 1250+4 = 1254 tokens — does NOT fit
    const result = truncateMessages([system, old, recent, current], 200);
    expect(result.some(m => m === recent)).toBe(true);
    expect(result.some(m => m === old)).toBe(false);
    expect(result[result.length - 1]).toEqual(current);
  });
});
