// src/contextUtils.ts

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

  // For each suffix length from minPhraseLen up to 1/3 of the window,
  // check if the last three occurrences of that suffix are consecutive
  // (i.e. the text ends with phrase+phrase+phrase).
  const maxPhraseLen = Math.floor(text.length / 3);
  for (let len = minPhraseLen; len <= maxPhraseLen; len++) {
    const phrase = text.slice(-len);
    const twice = text.slice(-(len * 2), -len);
    const thrice = text.slice(-(len * 3), -(len * 2));
    if (twice === phrase && thrice === phrase) {
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
