/**
 * Shared prompt/context-budget helpers for chat request preparation.
 *
 * Responsibilities:
 * - define base system prompt constraints used by chat flows
 * - estimate message token usage conservatively
 * - truncate message history to fit model context windows
 * - detect repetition loops in streamed output buffers
 */

import type { Message } from 'ollama';

/**
 * Base system prompt injected into every @ollama and LM API request.
 * Prevents models from announcing their Copilot integration unprompted and discourages repetitive filler phrases.
 */
export const BASE_SYSTEM_PROMPT =
  'You are a helpful coding assistant. Answer the user’s questions directly and concisely. ' +
  'Do not mention GitHub Copilot, VS Code, or that you are integrated with an IDE or development tool unless explicitly asked. ' +
  'Avoid repetitive filler phrases like "I will continue with" or "Let me proceed" — just provide the actual content or code.';

/** Rough token estimate: 4 chars ≈ 1 token. */
export const CHARS_PER_TOKEN = 4;

/**
 * Reserve tokens for the model's generated response.
 * Small models have tiny context windows; reserving too many would leave
 * no room for history. 512 is conservative but safe.
 */
const OUTPUT_TOKEN_RESERVE = 512;

/**
 * Maximum fraction of the budget a system message may consume.
 * VS Code injects massive XML context blocks — cap them at 40% of the
 * input budget so conversation history has room to breathe.
 */
const SYSTEM_BUDGET_FRACTION = 0.4;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function estimateMessageTokens(msg: Message): number {
  const content = typeof msg.content === 'string' ? msg.content : '';
  return estimateTokens(content) + 4; // ~4 token overhead per message
}

export function estimateMessagesTokens(messages: Message[]): number {
  return messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
}

/**
 * Truncate a message list to fit within a token budget.
 *
 * Strategy (in priority order):
 * 1. Always preserve the last message (the current user turn).
 * 2. Keep system messages but truncate their content if they alone exceed
 *    SYSTEM_BUDGET_FRACTION of the available budget.
 * 3. Fill remaining budget with history messages, newest first.
 * 4. Oldest history is silently dropped when the budget is exhausted.
 *
 * @param messages   Ordered message list (system, …history…, latest-user).
 * @param maxInputTokens  The model's maximum input token count (0 = no limit).
 * @returns A (possibly shorter) message list guaranteed to fit.
 */
export function truncateMessages(messages: Message[], maxInputTokens: number): Message[] {
  if (maxInputTokens <= 0 || messages.length === 0) return messages;

  const budget = Math.max(OUTPUT_TOKEN_RESERVE + 1, maxInputTokens - OUTPUT_TOKEN_RESERVE);

  if (estimateMessagesTokens(messages) <= budget) return messages;

  const systemMsgs = messages.filter(m => m.role === 'system');
  const convMsgs = messages.filter(m => m.role !== 'system');

  // Always keep the last message (current user turn).
  const lastMsg = convMsgs.slice(-1);
  const history = convMsgs.slice(0, -1);

  // Truncate system content if it exceeds its budget fraction.
  const systemBudget = Math.floor(budget * SYSTEM_BUDGET_FRACTION);
  let effectiveSystemMsgs = systemMsgs;

  const rawSystemTokens = estimateMessagesTokens(systemMsgs);
  if (rawSystemTokens > systemBudget) {
    const charLimit = systemBudget * CHARS_PER_TOKEN;
    effectiveSystemMsgs = systemMsgs.map(m => {
      const content = typeof m.content === 'string' ? m.content : '';
      if (content.length <= charLimit) return m;
      return { ...m, content: content.slice(0, charLimit) + '\n[context truncated for model context window]' };
    });
  }

  const effectiveSystemTokens = estimateMessagesTokens(effectiveSystemMsgs);
  const lastMsgTokens = estimateMessagesTokens(lastMsg);
  let historyBudget = budget - effectiveSystemTokens - lastMsgTokens;

  // Keep the most recent history that fits in budget.
  const keptHistory: Message[] = [];
  for (let i = history.length - 1; i >= 0 && historyBudget > 0; i--) {
    const tokens = estimateMessageTokens(history[i]);
    if (tokens <= historyBudget) {
      keptHistory.unshift(history[i]);
      historyBudget -= tokens;
    }
  }

  return [...effectiveSystemMsgs, ...keptHistory, ...lastMsg];
}

// TODO: Evaluate replacing `truncateMessages` with @vscode/prompt-tsx to get
// priority-based prompt composition and accurate token-budget pruning.
// See .beans/opilot-yqdn--040-evaluate-adopting-prompt-tsx-for-prompt-compos.md
// (deferred evaluation recorded in repository issues/plans).

/**
 * Detect whether streaming output has entered a repetition loop.
 *
 * @param buffer       Accumulated recent output (caller should keep last ~600 chars).
 * @param sensitivity  How aggressively to detect repetition.
 * @returns true when a repeated pattern is found and the stream should be stopped.
 */
export function detectsRepetition(buffer: string, sensitivity: 'off' | 'conservative' | 'moderate'): boolean {
  if (sensitivity === 'off' || buffer.length === 0) return false;

  const windowSize = sensitivity === 'conservative' ? 500 : 400;
  const minPhraseLen = sensitivity === 'conservative' ? 20 : 10;
  const text = buffer.slice(-windowSize);

  // O(n) suffix repetition scan using rolling hashes over the current window.
  // We still confirm candidates with direct string comparison to avoid false
  // positives from rare hash collisions.
  const n = text.length;
  const maxPhraseLen = Math.floor(n / 3);
  if (maxPhraseLen < minPhraseLen) {
    return false;
  }

  const base = 911382323;
  const prefix = new Uint32Array(n + 1);
  const pow = new Uint32Array(n + 1);
  pow[0] = 1;

  for (let i = 0; i < n; i++) {
    prefix[i + 1] = (Math.imul(prefix[i], base) + text.charCodeAt(i)) >>> 0;
    pow[i + 1] = Math.imul(pow[i], base) >>> 0;
  }

  const hashRange = (start: number, end: number): number => {
    const len = end - start;
    return (prefix[end] - Math.imul(prefix[start], pow[len])) >>> 0;
  };

  for (let len = minPhraseLen; len <= maxPhraseLen; len++) {
    const firstStart = n - 3 * len;
    const secondStart = n - 2 * len;
    const thirdStart = n - len;

    if (hashRange(firstStart, secondStart) !== hashRange(secondStart, thirdStart)) {
      continue;
    }
    if (hashRange(secondStart, thirdStart) !== hashRange(thirdStart, n)) {
      continue;
    }

    const first = text.slice(firstStart, secondStart);
    const second = text.slice(secondStart, thirdStart);
    const third = text.slice(thirdStart, n);
    if (first === second && second === third) {
      return true;
    }
  }

  return false;
}

/** Default context window cap when the model does not report one. */
export const DEFAULT_CONTEXT_TOKENS = 8192;

/**
 * Resolve the effective context-window token limit for message truncation.
 *
 * Priority:
 * 1. Per-model num_ctx override from model settings (user explicitly set this — wins over all)
 * 2. Model-reported maxInputTokens (from Ollama /api/show metadata)
 * 3. User-configured opilot.maxContextTokens setting
 * 4. Built-in default of 8 192 tokens
 */
export function resolveContextLimit(modelReported: number, modelOptNumCtx?: number, settingMax?: number): number {
  if (modelOptNumCtx && modelOptNumCtx > 0) return modelOptNumCtx;
  if (modelReported > 0) return modelReported;
  if (settingMax && settingMax > 0) return settingMax;
  return DEFAULT_CONTEXT_TOKENS;
}

/**
 * Render a prompt using @vscode/prompt-tsx when available; otherwise fall back to
 * the synchronous `truncateMessages` approach. This function is async to allow
 * integration with renderers that may query tokenizers or perform async work.
 */
export async function renderOllamaPrompt(
  messages: Message[],
  maxInputTokens: number,
  tokenCountFn?: (text: string) => number,
): Promise<Message[]> {
  // If prompt-tsx is available, prefer it for priority-based composition.
  try {
    // Dynamic import so we don't hard-depend on the package until opted-in.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const promptTsx = require('@vscode/prompt-tsx');
    if (promptTsx && typeof promptTsx.renderPrompt === 'function') {
      // The library's renderPrompt API is expected to return an ordered array
      // of string chunks; adapt them back to Message objects. This is a best-effort
      // bridge and kept defensive to avoid runtime crashes if the shape differs.
      const rendered = await promptTsx.renderPrompt(messages, { budget: Math.max(0, maxInputTokens - OUTPUT_TOKEN_RESERVE) }, tokenCountFn);
      if (Array.isArray(rendered)) {
        return rendered.map((r: any) => ({ role: 'user', content: String(r) } as unknown as Message));
      }
    }
  } catch {
    // Ignore and fall back.
  }

  // Synchronous conservative fallback.
  return truncateMessages(messages, maxInputTokens);
}
