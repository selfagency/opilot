/**
 * Shared prompt/context-budget helpers for chat request preparation.
 *
 * Responsibilities:
 * - define base system prompt constraints used by chat flows
 * - estimate message token usage conservatively
 * - truncate message history to fit model context windows
 * - detect repetition loops in streamed output buffers
 */

import { OutputMode, Raw, renderPrompt, type ITokenizer } from '@vscode/prompt-tsx';
import type { Message } from 'ollama';
import { OllamaPrompt } from './prompts/OllamaPrompt.js';
import type { ResolvedReference } from './prompts/OllamaPrompt.js';

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

// DEFERRED: Replacing `truncateMessages` with @vscode/prompt-tsx is tracked
// in bean opilot-yqdn--040. This would provide priority-based prompt composition
// and accurate token-budget pruning but requires significant refactoring.
// Status: Deferred pending Phase 3+ completion.
// See: .beans/opilot-yqdn--040-evaluate-adopting-prompt-tsx-for-prompt-compos.md

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
 * Render a prompt using @vscode/prompt-tsx for priority-based context pruning.
 *
 * Messages are decomposed into system content, conversation history, and the
 * current user turn, passed through the OllamaPrompt TSX component, then
 * converted back to Ollama Message objects. Falls back to the synchronous
 * truncateMessages approach when the message list cannot be decomposed (e.g.,
 * contains tool turns) or on any render error.
 */
export async function renderOllamaPrompt(
  messages: Message[],
  maxInputTokens: number,
  tokenCountFn?: (text: string) => number,
  references?: ReadonlyArray<ResolvedReference>,
): Promise<Message[]> {
  if (maxInputTokens <= 0 || messages.length === 0) return messages;

  const countFn = tokenCountFn ?? ((text: string) => Math.ceil(text.length / CHARS_PER_TOKEN));

  // Decompose the flat message list into structured parts.
  const systemMsgs = messages.filter(m => m.role === 'system');
  const nonSystem = messages.filter(m => m.role !== 'system');

  // Require a final user turn and only user/assistant turns in history.
  const lastMsg = nonSystem.at(-1);
  const historyMsgs = nonSystem.slice(0, -1);
  const hasToolTurns = historyMsgs.some(m => m.role !== 'user' && m.role !== 'assistant');
  if (!lastMsg || hasToolTurns) {
    return truncateMessages(messages, maxInputTokens);
  }

  const systemContent = systemMsgs.map(m => (typeof m.content === 'string' ? m.content : '')).join('\n\n');
  const history = historyMsgs
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({
      role: m.role as 'user' | 'assistant',
      content: typeof m.content === 'string' ? m.content : '',
    }));
  const userContent = typeof lastMsg.content === 'string' ? lastMsg.content : '';

  const tokenizer: ITokenizer<OutputMode.Raw> = {
    mode: OutputMode.Raw,
    tokenLength(part: Raw.ChatCompletionContentPart): number {
      if (part.type === Raw.ChatCompletionContentPartKind.Text) {
        return countFn((part as Raw.ChatCompletionContentPartText).text);
      }
      return 1;
    },
    countMessageTokens(message: Raw.ChatMessage): number {
      let total = 4; // role overhead
      for (const part of message.content) {
        const len = this.tokenLength(part);
        total += typeof len === 'number' ? len : 1;
      }
      return total;
    },
  };

  try {
    const endpoint = { modelMaxPromptTokens: maxInputTokens - OUTPUT_TOKEN_RESERVE };
    const result = await renderPrompt(
      OllamaPrompt,
      { systemContent, history, userContent, references },
      endpoint,
      tokenizer,
    );

    const hasNonTextParts = result.messages.some((message: Raw.ChatMessage) =>
      message.content.some(
        (part: Raw.ChatCompletionContentPart) => part.type !== Raw.ChatCompletionContentPartKind.Text,
      ),
    );
    if (hasNonTextParts) {
      return truncateMessages(messages, maxInputTokens);
    }

    return result.messages.map((m: Raw.ChatMessage) => ({
      role: chatRoleToString(m.role),
      content: m.content
        .filter((p: Raw.ChatCompletionContentPart) => p.type === Raw.ChatCompletionContentPartKind.Text)
        .map((p: Raw.ChatCompletionContentPart) => (p as Raw.ChatCompletionContentPartText).text)
        .join(''),
    }));
  } catch {
    return truncateMessages(messages, maxInputTokens);
  }
}

function chatRoleToString(role: Raw.ChatRole): string {
  switch (role) {
    case Raw.ChatRole.System:
      return 'system';
    case Raw.ChatRole.User:
      return 'user';
    case Raw.ChatRole.Assistant:
      return 'assistant';
    case Raw.ChatRole.Tool:
      return 'tool';
  }
}
