import { compressConversation } from '@agentsy/context';
import type { Message } from 'ollama';
import {
  CHARS_PER_TOKEN,
  estimateMessagesTokens,
  estimateMessageTokens,
  OUTPUT_TOKEN_RESERVE,
  SYSTEM_BUDGET_FRACTION
} from './context-utils.js';

/**
 * Intelligent conversation compression using @agentsy/context.
 *
 * @param messages        Ordered message list (system, …history…, latest-user).
 * @param maxInputTokens  Total token budget for the input.
 * @returns               Compressed message list.
 */
// biome-ignore lint/suspicious/useAwait: API contract — must return a Promise for async callers.
export async function compressToContext(messages: Message[], maxInputTokens: number): Promise<Message[]> {
  if (maxInputTokens <= 0 || messages.length === 0) {
    return messages;
  }

  const budget = Math.max(OUTPUT_TOKEN_RESERVE + 1, maxInputTokens - OUTPUT_TOKEN_RESERVE);

  const currentTokens = estimateMessagesTokens(messages);
  if (currentTokens <= budget) {
    return messages;
  }

  const systemMsgs = messages.filter(m => m.role === 'system');
  const convMsgs = messages.filter(m => m.role !== 'system');

  // Always keep the last message (current user turn) if it exists.
  const lastMsg = convMsgs.length > 0 ? convMsgs.slice(-1) : [];
  const history = convMsgs.length > 0 ? convMsgs.slice(0, -1) : [];

  // Truncate system content if it exceeds its budget fraction.
  const systemBudget = Math.floor(budget * SYSTEM_BUDGET_FRACTION);
  let effectiveSystemMsgs = systemMsgs;

  const rawSystemTokens = estimateMessagesTokens(systemMsgs);
  if (rawSystemTokens > systemBudget) {
    const charLimit = systemBudget * CHARS_PER_TOKEN;
    effectiveSystemMsgs = systemMsgs.map(m => {
      const content = typeof m.content === 'string' ? m.content : '';
      if (content.length <= charLimit) {
        return m;
      }
      return {
        ...m,
        content: `${content.slice(0, charLimit)}\n[context truncated for model context window]`
      };
    });
  }

  const effectiveSystemTokens = estimateMessagesTokens(effectiveSystemMsgs);
  const lastMsgTokens = estimateMessagesTokens(lastMsg);
  const historyBudget = budget - effectiveSystemTokens - lastMsgTokens;

  // Use @agentsy/context to compress the history part
  let keptHistory: Message[] = [];
  if (history.length > 0 && historyBudget > 0) {
    const result = compressConversation<Message>(history, {
      maxTokens: historyBudget,
      preserveLast: 0,
      estimateTokens: estimateMessageTokens
    });
    keptHistory = result.messages;
  }

  return [...effectiveSystemMsgs, ...keptHistory, ...lastMsg];
}
