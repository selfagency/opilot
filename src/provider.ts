import { Ollama } from 'ollama';
import {
  CancellationToken,
  EventEmitter,
  ExtensionContext,
  LanguageModelChatInformation,
  LanguageModelChatMessageRole,
  LanguageModelChatProvider,
  LanguageModelChatRequestMessage,
  LanguageModelDataPart,
  LanguageModelResponsePart,
  LanguageModelTextPart,
  LanguageModelToolCallPart,
  LanguageModelToolResultPart,
  Progress,
  ProvideLanguageModelChatResponseOptions,
  window,
} from 'vscode';
import { getContextLengthOverride, getOllamaClient } from './client';
import type { DiagnosticsLogger } from './diagnostics.js';

const MODEL_LIST_REFRESH_MIN_INTERVAL_MS = 30_000;
const MODEL_INFO_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Ollama Chat Model Provider
 */
export class OllamaChatModelProvider implements LanguageModelChatProvider<LanguageModelChatInformation> {
  private models: Map<string, LanguageModelChatInformation> = new Map();
  private modelInfoCache: Map<string, { info: LanguageModelChatInformation; updatedAtMs: number }> = new Map();
  private cachedModelList: LanguageModelChatInformation[] = [];
  private lastModelListRefreshMs = 0;
  private modelsChangeEventEmitter: EventEmitter<void> = new EventEmitter();
  private toolCallIdMap: Map<string, string> = new Map();
  private reverseToolCallIdMap: Map<string, string> = new Map();

  readonly onDidChangeLanguageModelChatInformation = this.modelsChangeEventEmitter.event;

  constructor(
    readonly context: ExtensionContext,
    private client: Ollama,
    private outputChannel: DiagnosticsLogger,
  ) {}

  /**
   * Provide information about available chat models
   */
  async provideLanguageModelChatInformation(
    _options: { silent: boolean },
    _token: CancellationToken,
  ): Promise<LanguageModelChatInformation[]> {
    const now = Date.now();
    if (this.cachedModelList.length > 0 && now - this.lastModelListRefreshMs < MODEL_LIST_REFRESH_MIN_INTERVAL_MS) {
      return this.cachedModelList;
    }

    try {
      const response = await this.client.list();
      const modelNames = new Set(response.models.map(model => model.name));
      this.pruneModelCache(modelNames);

      const models = await Promise.all(
        response.models.map(async model => {
          const cached = this.modelInfoCache.get(model.name);
          if (cached && now - cached.updatedAtMs < MODEL_INFO_CACHE_TTL_MS) {
            return cached.info;
          }

          const info = await this.getChatModelInfo(model.name);
          if (info) {
            const updatedAtMs = Date.now();
            this.modelInfoCache.set(model.name, { info, updatedAtMs });
            this.models.set(model.name, info);
          }

          return info;
        }),
      );

      const resolvedModels = models.filter((model): model is LanguageModelChatInformation => Boolean(model));
      this.cachedModelList = resolvedModels;
      this.lastModelListRefreshMs = Date.now();

      if (resolvedModels.length > 0) {
        this.modelsChangeEventEmitter.fire();
        return resolvedModels;
      }

      if (this.cachedModelList.length > 0) {
        return this.cachedModelList;
      }

      return [];
    } catch (error) {
      this.outputChannel.exception('[Ollama] Failed to fetch models', error);
      return this.cachedModelList;
    }
  }

  private pruneModelCache(activeModelNames: Set<string>): void {
    for (const modelName of this.modelInfoCache.keys()) {
      if (!activeModelNames.has(modelName)) {
        this.modelInfoCache.delete(modelName);
        this.models.delete(modelName);
      }
    }
  }

  private clearModelCache(): void {
    this.modelInfoCache.clear();
    this.models.clear();
    this.cachedModelList = [];
    this.lastModelListRefreshMs = 0;
  }

  /**
   * Get information about a specific model
   */
  private async getChatModelInfo(modelId: string): Promise<LanguageModelChatInformation | undefined> {
    try {
      const response = await this.client.show({ model: modelId });

      return {
        id: modelId,
        name: formatModelName(modelId),
        family: 'ollama',
        version: '1.0.0',
        maxInputTokens: getContextLengthOverride(),
        maxOutputTokens: getContextLengthOverride(),
        capabilities: {
          imageInput: this.isVisionModel(response),
          toolCalling: this.isToolModel(response),
        },
      };
    } catch (error) {
      this.outputChannel.exception(`[Ollama] Failed to get model info for ${modelId}`, error);
      return undefined;
    }
  }

  /**
   * Check if model supports tool use
   */
  private isToolModel(modelResponse: unknown): boolean {
    const response = modelResponse as Record<string, unknown>;
    const template = response.template as string | undefined;
    return template ? template.includes('{{ .Tools }}') : false;
  }

  /**
   * Check if model supports vision/image inputs
   */
  private isVisionModel(modelResponse: unknown): boolean {
    const response = modelResponse as Record<string, unknown>;
    const details = response.details as Record<string, unknown> | undefined;
    const families = details?.families as string[] | undefined;
    return families ? families.includes('clip') || families.includes('vision') : false;
  }

  /**
   * Provide language model chat response
   */
  async provideLanguageModelChatResponse(
    model: LanguageModelChatInformation,
    messages: readonly LanguageModelChatRequestMessage[],
    options: ProvideLanguageModelChatResponseOptions,
    progress: Progress<LanguageModelResponsePart>,
    token: CancellationToken,
  ): Promise<void> {
    try {
      this.clearToolCallIdMappings();

      // Convert VS Code messages to Ollama format
      const ollamaMessages = this.toOllamaMessages(messages);

      // Build tools array if supported
      let tools: Parameters<typeof this.client.chat>[0]['tools'] | undefined;
      if (options.tools && options.tools.length > 0 && model.capabilities.toolCalling) {
        tools = options.tools.map(tool => ({
          type: 'function' as const,
          function: {
            name: tool.name,
            description: tool.description || '',
            parameters: tool.inputSchema as Record<string, unknown>,
          },
        }));
      }

      // Stream chat response
      const response = await this.client.chat({
        model: model.id,
        messages: ollamaMessages,
        stream: true,
        tools,
      });

      for await (const chunk of response) {
        if (token.isCancellationRequested) {
          break;
        }

        // Stream text chunks immediately as they arrive
        if (chunk.message?.content) {
          progress.report(new LanguageModelTextPart(chunk.message.content));
        }

        // Handle tool calls
        if (chunk.message?.tool_calls && Array.isArray(chunk.message.tool_calls)) {
          for (const toolCall of chunk.message.tool_calls) {
            const vsCodeId = this.generateToolCallId();
            this.mapToolCallId(vsCodeId, vsCodeId);

            progress.report(
              new LanguageModelToolCallPart(
                vsCodeId,
                toolCall.function?.name || '',
                toolCall.function?.arguments || {},
              ),
            );
          }
        }
      }
    } catch (error) {
      this.outputChannel.exception('[Ollama] Chat response failed', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      progress.report(new LanguageModelTextPart(`Error: ${errorMessage}`));
    }
  }

  /**
   * Convert VS Code messages to Ollama message format
   */
  private toOllamaMessages(
    messages: readonly LanguageModelChatRequestMessage[],
  ): Parameters<typeof this.client.chat>[0]['messages'] {
    const ollamaMessages: Parameters<typeof this.client.chat>[0]['messages'] = [];

    for (const msg of messages) {
      const role = msg.role === LanguageModelChatMessageRole.User ? 'user' : 'assistant';
      const ollamaMsg: Record<string, unknown> = { role };

      // Extract and assemble content
      const contentParts: (string | Record<string, unknown>)[] = [];
      let textContent = '';

      for (const part of msg.content) {
        if (part instanceof LanguageModelTextPart) {
          textContent += part.value;
        } else if (part instanceof LanguageModelDataPart) {
          const base64Data = typeof part.data === 'string' ? part.data : Buffer.from(part.data).toString('base64');

          contentParts.push({
            type: 'image',
            image: {
              url: `data:image/jpeg;base64,${base64Data}`,
            },
          });
        } else if (part instanceof LanguageModelToolCallPart) {
          ollamaMsg.tool_calls = ollamaMsg.tool_calls || [];
          (ollamaMsg.tool_calls as Record<string, unknown>[]).push({
            id: this.getOllamaToolCallId(part.callId),
            function: {
              name: part.name,
              arguments: part.input,
            },
          });
        } else if (part instanceof LanguageModelToolResultPart) {
          // Tool results become separate messages
          // Note: Ollama's Message type doesn't have tool_call_id field, so we only send role and content
          ollamaMessages.push({
            role: 'tool',
            content: JSON.stringify(part.content),
          });
        }
      }

      if (textContent) {
        contentParts.unshift(textContent);
      }

      if (contentParts.length === 1 && typeof contentParts[0] === 'string') {
        ollamaMsg.content = contentParts[0];
      } else if (contentParts.length > 0) {
        ollamaMsg.content = contentParts;
      }

      if (ollamaMsg.content || ollamaMsg.tool_calls) {
        ollamaMessages.push(ollamaMsg as never);
      }
    }

    return ollamaMessages;
  }

  /**
   * Generate a VS Code tool call ID (9 alphanumeric characters)
   */
  private generateToolCallId(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let id = '';
    for (let i = 0; i < 9; i++) {
      id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return id;
  }

  /**
   * Map VS Code tool call ID to Ollama tool call ID
   */
  private mapToolCallId(vsCodeId: string, ollamaId: string): void {
    this.toolCallIdMap.set(vsCodeId, ollamaId);
    this.reverseToolCallIdMap.set(ollamaId, vsCodeId);
  }

  /**
   * Get Ollama tool call ID from VS Code ID
   */
  private getOllamaToolCallId(vsCodeId: string): string {
    return this.toolCallIdMap.get(vsCodeId) || vsCodeId;
  }

  /**
   * Clear tool call ID mappings
   */
  public clearToolCallIdMappings(): void {
    this.toolCallIdMap.clear();
    this.reverseToolCallIdMap.clear();
  }

  /**
   * Provide token count estimate
   */
  async provideTokenCount(
    _model: LanguageModelChatInformation,
    text: string | LanguageModelChatRequestMessage,
    _token: CancellationToken,
  ): Promise<number> {
    // Ollama doesn't have a public tokenize endpoint, so use a heuristic
    // Estimate: ~1 token per 4 characters (varies by model, this is approximate)
    let textContent = '';
    if (typeof text === 'string') {
      textContent = text;
    } else {
      // Extract text from message parts
      textContent = text.content
        .map(part => {
          if (part instanceof LanguageModelTextPart) {
            return part.value;
          } else if (part instanceof LanguageModelToolCallPart) {
            return part.name + JSON.stringify(part.input);
          } else if (part instanceof LanguageModelToolResultPart) {
            return String(part.content);
          }
          return '';
        })
        .join('');
    }

    return Math.ceil(textContent.length / 4);
  }

  /**
   * Manage authentication token with status display and clear option
   */
  async setAuthToken(): Promise<void> {
    const existingToken = await this.context.secrets.get('ollama-auth-token');
    const status = existingToken ? '✓ Authenticated' : '○ Anonymous';

    const action = await window.showQuickPick(
      [
        { label: `${status}`, description: 'Current authentication status', kind: -1 },
        { label: 'Set Token', description: 'Enter a new authentication token' },
        ...(existingToken ? [{ label: 'Clear Token', description: 'Remove stored authentication' }] : []),
      ],
      { matchOnDescription: true, ignoreFocusOut: true },
    );

    if (!action) return;

    if (action.label === 'Clear Token') {
      await this.context.secrets.delete('ollama-auth-token');
      this.outputChannel.info('Ollama authentication token cleared');
      this.client = await getOllamaClient(this.context);
      this.clearModelCache();
      this.modelsChangeEventEmitter.fire();
    } else if (action.label === 'Set Token') {
      const token = await window.showInputBox({
        prompt: 'Enter Ollama authentication token (leave empty for anonymous)',
        password: true,
        ignoreFocusOut: true,
      });

      if (token !== undefined) {
        if (token) {
          await this.context.secrets.store('ollama-auth-token', token);
          this.outputChannel.info('Ollama authentication token updated');
        } else {
          await this.context.secrets.delete('ollama-auth-token');
          this.outputChannel.info('Ollama authentication token cleared');
        }
        // Reinitialize client with new token
        this.client = await getOllamaClient(this.context);
        this.clearModelCache();
        this.modelsChangeEventEmitter.fire();
      }
    }
  }
}

/**
 * Format model name for display
 */
export function formatModelName(modelId: string): string {
  return modelId
    .replace(/^ollama\//, '')
    .replace(/-/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
