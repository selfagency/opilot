/**
 * Phase 5: Chat Participant Enhancements
 *
 * Provides advanced ChatParticipant features:
 * - titleProvider: Auto-generate conversation titles using Ollama
 * - summarizer: Compress long conversation history
 * - helpTextPrefix: Custom help text for /help
 * - additionalWelcomeMessage: Server status on first open
 * - followupProvider: Suggest contextual follow-ups
 * - participantVariableProvider: Model selector completions (@ollama:llama3.2)
 */

import type { Ollama } from 'ollama';
import * as vscode from 'vscode';
import type { DiagnosticsLogger } from './diagnostics.js';

export interface ParticipantFeaturesContext {
  client: Ollama;
  diagnostics?: DiagnosticsLogger;
  modelId: string;
  serverHost?: string;
}

type ParticipantVariableCompletionItem = {
  label: string;
  description?: string;
  values: string[];
};

/**
 * Phase 5.1: titleProvider — Auto-generate conversation titles
 * Sends first message to Ollama: "Summarize in 5-8 words: [message]"
 * Caches result to avoid repeated calls.
 */
export function createTitleProvider(ctx: ParticipantFeaturesContext) {
  const titleCache = new Map<string, string>();

  return {
    async provideChatTitle(firstMessage: string): Promise<string> {
      if (!firstMessage || firstMessage.length === 0) return 'New Conversation';

      // Limit cache to 100 conversations
      if (titleCache.size > 100) {
        const firstKey = titleCache.keys().next().value;
        if (firstKey) titleCache.delete(firstKey);
      }

      const cacheKey = firstMessage.substring(0, 100);
      const cachedTitle = titleCache.get(cacheKey);
      if (cachedTitle) {
        return cachedTitle;
      }

      try {
        const systemPrompt =
          'You are a helpful assistant. Summarize the user request in exactly 5-8 words. Reply with ONLY the summary, no punctuation.';
        const response = await ctx.client.generate({
          model: ctx.modelId,
          prompt: `${systemPrompt}\n\nUser request: ${firstMessage}`,
          stream: false,
        });

        let title = response.response.trim();
        if (title.length === 0) title = 'New Conversation';
        if (title.length > 60) title = `${title.substring(0, 57)}...`;

        titleCache.set(cacheKey, title);
        return title;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.diagnostics?.debug?.(`[participantFeatures] title generation failed: ${msg}`);
        return 'New Conversation';
      }
    },
  };
}

/**
 * Phase 5.2: summarizer — Compress long conversation history
 * Sends: "Summarize this conversation:\n[messages]\n\nProvide 1-2 sentences."
 */
export function createSummarizer(ctx: ParticipantFeaturesContext) {
  return {
    async summarizeMessages(messages: vscode.LanguageModelChatMessage[]): Promise<string> {
      try {
        // Filter to last 20 messages to keep prompt manageable
        const recentMessages = messages.slice(-20);
        const conversationText = recentMessages
          .map((message: vscode.LanguageModelChatMessage) => {
            const roleLabel = message.role === vscode.LanguageModelChatMessageRole.User ? 'User' : 'Assistant';
            const contentText = Array.isArray(message.content)
              ? message.content
                  .filter((part): part is vscode.LanguageModelTextPart => part instanceof vscode.LanguageModelTextPart)
                  .map(part => part.value)
                  .join('')
              : '';
            return `${roleLabel}: ${contentText}`;
          })
          .join('\n');

        const systemPrompt = 'Summarize this conversation in 1-2 sentences for later reference.';
        const response = await ctx.client.generate({
          model: ctx.modelId,
          prompt: `${systemPrompt}\n\nConversation:\n${conversationText}`,
          stream: false,
        });

        return response.response.trim();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.diagnostics?.debug?.(`[participantFeatures] summarization failed: ${msg}`);
        return '';
      }
    },
  };
}

/**
 * Phase 5.3: helpTextPrefix — Custom help text for /help
 */
export function getHelpTextPrefix(): string {
  return `
## Ollama Local Models

Chat with models running on your local Ollama instance or remote server.

**Capabilities:**
- 🧠 Thinking models (qwen3, deepseek-r1, etc.)
- 👁️ Vision models with image analysis
- 🛠️ Native tool calling and function invocation
- 📝 Modelfile customization and creation

**Common models:**
- \`llama3.2:3b\` — Fast, general-purpose
- \`llama3.2:11b\` — Larger, more capable
- \`qwen3:8b\` — Reasoning/thinking
- \`mistral:latest\` — Advanced generation
- \`llava:13b\` — Vision model

**Tips:**
- Use \`@ollama:model-name\` to select a specific model
- Check **View > Ollama** sidebar for model management
- Create custom models via **Ollama: Create Modelfile**
`;
}

/**
 * Phase 5.4: additionalWelcomeMessage — Server status on first open
 */
export async function getAdditionalWelcomeMessage(ctx: ParticipantFeaturesContext): Promise<string> {
  try {
    // Use a short timeout to avoid stalling activation when the Ollama host is slow or unreachable.
    const timeoutMs = 3000;
    const withTimeout = async <T>(p: Promise<T>, ms: number): Promise<T> => {
      return await Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
    };

    const list = (await withTimeout(ctx.client.list(), timeoutMs)) as Awaited<ReturnType<typeof ctx.client.list>>;
    const ps = (await withTimeout(ctx.client.ps(), timeoutMs)) as Awaited<ReturnType<typeof ctx.client.ps>>;
    const modelCount = list.models.length;
    const runningCount = ps.models.length;
    const host = ctx.serverHost || 'localhost:11434';

    return `
Connected to **${host}**
${modelCount} models available · ${runningCount} running
    `.trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.diagnostics?.debug?.(`[participantFeatures] welcome message unavailable: ${message}`);
    return 'Ollama server offline or unreachable';
  }
}

/**
 * Phase 5.5: followupProvider — Suggest contextual follow-ups
 */
export function createFollowupProvider() {
  return {
    async provideFollowups(
      request: vscode.ChatRequest,
      _response: vscode.ChatResult,
    ): Promise<vscode.ChatFollowup[] | undefined> {
      const prompt = request.prompt?.toLowerCase() || '';

      // Heuristic follow-ups based on response content
      const followups: vscode.ChatFollowup[] = [];

      // Code response → apply to file
      if (prompt.includes('refactor') || prompt.includes('fix') || prompt.includes('improve')) {
        followups.push({
          prompt: 'Apply these changes to my file',
          label: '📝 Apply to file',
          tooltip: 'Open the suggested changes in an editor',
        });
      }

      // Explanation response → elaborate
      if (prompt.includes('explain') || prompt.includes('how') || prompt.includes('what')) {
        followups.push({
          prompt: 'Can you explain that further?',
          label: '🔍 Explain more',
          tooltip: 'Get more details on the topic',
        });
      }

      // Model list response → pull a model
      if (prompt.includes('available models') || prompt.includes('which models')) {
        followups.push({
          prompt: 'Pull one of these models',
          label: '⬇️ Pull a model',
          tooltip: 'Download a model from Ollama Library',
        });
      }

      // Generic followup
      followups.push({
        prompt: 'Continue on this topic',
        label: '➡️ Continue',
        tooltip: 'Ask more about this topic',
      });

      return followups.length > 0 ? followups : undefined;
    },
  };
}

/**
 * Phase 5.6: participantVariableProvider — Model selector completions
 * Provides @ollama:model-name completions for all available models
 */
export function createParticipantVariableProvider(ctx: ParticipantFeaturesContext) {
  return {
    triggerCharacters: ['@', ':'],
    async provideCompletionItems(_token: vscode.CancellationToken): Promise<ParticipantVariableCompletionItem[]> {
      try {
        if (_token?.isCancellationRequested) return [];

        const list = await ctx.client.list();
        const items: ParticipantVariableCompletionItem[] = list.models
          .filter(model => typeof model?.name === 'string')
          .map(model => ({
            label: model.name,
            description: `${(model.size / 1e9).toFixed(1)}GB`,
            values: [model.name],
          }));

        return items;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        ctx.diagnostics?.debug?.(`[participantFeatures] model completions failed: ${msg}`);
        return [];
      }
    },
  };
}

/**
 * Phase 5.7: registerChatParticipantDetectionProvider
 * Teaches VS Code to auto-route certain queries to @ollama
 * Keywords: "ollama", "local model", "llama", "mistral", etc.
 */
export function createParticipantDetectionProvider() {
  // Keep keywords focused on Ollama-specific phrases to avoid false positives
  const keywords = ['ollama', 'local model', 'llama', 'mistral', 'deepseek', 'qwen'];

  return {
    detectChatParticipant(input: string): boolean {
      const lower = input.toLowerCase();
      return keywords.some(kw => lower.includes(kw));
    },
  };
}
