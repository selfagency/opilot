/**
 * @vscode/prompt-tsx component for building Ollama chat prompts.
 *
 * Composes a system prompt, conversation history, and the current user turn
 * with priority-based token budget allocation:
 *   - System prompt: highest priority, capped at SYSTEM_BUDGET_FRACTION
 *   - Current user turn: second-highest priority (always preserved)
 *   - History: graduated priority (oldest = lowest), pruned first when budget is tight
 *
 * TSX compiled with jsxFactory=vscpp / jsxFragmentFactory=vscppf (classic mode).
 * The `vscpp` and `vscppf` globals are injected by @vscode/prompt-tsx/dist/base/tsx.
 */

import {
  AssistantMessage,
  PrioritizedList,
  PromptElement,
  SystemMessage,
  TextChunk,
  UserMessage,
  type BasePromptElementProps,
  type PromptPiece,
  type PromptSizing,
} from '@vscode/prompt-tsx';

export interface ResolvedReference {
  /** Human-readable label (e.g. file path or "line 3-10 of foo.ts") */
  label: string;
  /** File/selection content as plain text */
  content: string;
}

export interface OllamaPromptProps extends BasePromptElementProps {
  /** Base system instruction text */
  systemContent: string;
  /** Ordered conversation history (oldest first, excluding current user turn) */
  history: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>;
  /** The current user message (always preserved at near-max priority) */
  userContent: string;
  /**
   * Explicitly attached file/selection references resolved to text.
   * Rendered just below the current user turn; pruned before the user turn
   * when budget is tight.
   */
  references?: ReadonlyArray<ResolvedReference>;
}

/**
 * Top-level prompt assembler for Ollama requests.
 *
 * Priority scheme:
 *   MAX_SAFE_INTEGER     → system prompt (never pruned)
 *   MAX_SAFE_INTEGER - 1 → current user turn (never pruned)
 *   MAX_SAFE_INTEGER - 2 → attached file/selection references (pruned before user turn)
 *   80                   → last 2 history turns (retained as long as possible)
 *   10                   → older history turns (pruned first)
 *
 * `PrioritizedList` with `descending={false}` assigns priorities from the given
 * base offset in ascending order, preserving chronological message ordering when
 * the renderer prunes budget-overflow items.
 *
 * The `<TextChunk breakOnWhitespace>` wrapper around the system content ensures
 * the renderer truncates it cleanly at word boundaries when the budget is tight,
 * rather than cutting mid-word.
 */
export class OllamaPrompt extends PromptElement<OllamaPromptProps> {
  render(_state: undefined, _sizing: PromptSizing): PromptPiece {
    const { systemContent, history, userContent, references } = this.props;

    // Split history: last 2 turns kept at higher priority than everything older.
    const RECENT_N = 2;
    const olderHistory = history.slice(0, -RECENT_N);
    const recentHistory = history.slice(-RECENT_N);

    // Build reference block text: each reference wrapped in an XML <context> tag.
    const refBlock =
      references && references.length > 0
        ? references.map(r => `<context>\n${r.label}:\n\`\`\`\n${r.content}\n\`\`\`\n</context>`).join('\n\n')
        : null;

    return (
      <>
        <SystemMessage priority={Number.MAX_SAFE_INTEGER}>
          <TextChunk breakOnWhitespace>{systemContent}</TextChunk>
        </SystemMessage>
        <PrioritizedList priority={10} descending={false}>
          {olderHistory.map(msg =>
            msg.role === 'user' ? vscpp(UserMessage, {}, msg.content) : vscpp(AssistantMessage, {}, msg.content),
          )}
        </PrioritizedList>
        <PrioritizedList priority={80} descending={false}>
          {recentHistory.map(msg =>
            msg.role === 'user' ? vscpp(UserMessage, {}, msg.content) : vscpp(AssistantMessage, {}, msg.content),
          )}
        </PrioritizedList>
        {refBlock && (
          <UserMessage priority={Number.MAX_SAFE_INTEGER - 2}>
            <TextChunk breakOnWhitespace>{refBlock}</TextChunk>
          </UserMessage>
        )}
        <UserMessage priority={Number.MAX_SAFE_INTEGER - 1}>{userContent}</UserMessage>
      </>
    );
  }
}
