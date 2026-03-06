import { Ollama, type ChatResponse, type ShowResponse } from 'ollama';
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

const MODEL_LIST_REFRESH_MIN_INTERVAL_MS = 5_000;
const MODEL_INFO_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MODEL_SHOW_TIMEOUT_MS = 2_000;

/**
 * Ollama Chat Model Provider
 */
export class OllamaChatModelProvider implements LanguageModelChatProvider<LanguageModelChatInformation> {
  private models: Map<string, LanguageModelChatInformation> = new Map();
  private modelInfoCache: Map<string, { info: LanguageModelChatInformation; updatedAtMs: number }> = new Map();
  private cachedModelList: LanguageModelChatInformation[] = [];
  private lastModelListRefreshMs = 0;
  private modelListRefreshPromise: Promise<LanguageModelChatInformation[]> | undefined;
  private modelsChangeEventEmitter: EventEmitter<void> = new EventEmitter();
  private toolCallIdMap: Map<string, string> = new Map();
  private reverseToolCallIdMap: Map<string, string> = new Map();
  private thinkingModels = new Set<string>();
  private nonThinkingModels = new Set<string>();

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

    if (this.modelListRefreshPromise) {
      return this.modelListRefreshPromise;
    }

    this.modelListRefreshPromise = this.refreshModelList();
    try {
      return await this.modelListRefreshPromise;
    } finally {
      this.modelListRefreshPromise = undefined;
    }
  }

  private async refreshModelList(): Promise<LanguageModelChatInformation[]> {
    const now = Date.now();

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

          const info = await this.getChatModelInfoWithFallback(model.name);
          const updatedAtMs = Date.now();
          this.modelInfoCache.set(model.name, { info, updatedAtMs });
          this.models.set(model.name, info);
          return info;
        }),
      );

      const resolvedModels = models.filter((model): model is LanguageModelChatInformation => Boolean(model));
      this.cachedModelList = resolvedModels;
      this.lastModelListRefreshMs = Date.now();

      return resolvedModels.length > 0 ? resolvedModels : this.cachedModelList;
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
   * Invalidate the model list cache and notify VS Code to re-query.
   * Preserves per-model info cache so unchanged models don't get re-fetched.
   */
  refreshModels(): void {
    this.cachedModelList = [];
    this.lastModelListRefreshMs = 0;
    this.modelsChangeEventEmitter.fire();
  }

  /**
   * Build lightweight model information when detailed metadata is unavailable.
   */
  private getBaseChatModelInfo(modelId: string): LanguageModelChatInformation {
    const contextLength = getContextLengthOverride();
    return {
      id: modelId,
      name: formatModelName(modelId),
      family: '🦙 Ollama',
      version: '1.0.0',
      detail: '🦙 Ollama',
      tooltip: `🦙 Ollama • ${modelId}`,
      maxInputTokens: contextLength,
      maxOutputTokens: contextLength,
      capabilities: {
        imageInput: false,
        toolCalling: false,
      },
    };
  }

  /**
   * Resolve chat model information with a timeout fallback so model discovery
   * cannot block chat startup on slow /api/show responses.
   */
  private async getChatModelInfoWithFallback(modelId: string): Promise<LanguageModelChatInformation> {
    const fallback = this.getBaseChatModelInfo(modelId);

    try {
      const timed = await Promise.race<LanguageModelChatInformation | undefined>([
        this.getChatModelInfo(modelId),
        new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), MODEL_SHOW_TIMEOUT_MS)),
      ]);

      return timed ?? fallback;
    } catch {
      return fallback;
    }
  }

  /**
   * Get information about a specific model
   */
  private async getChatModelInfo(modelId: string): Promise<LanguageModelChatInformation | undefined> {
    try {
      const response = await this.client.show({ model: modelId });

      // Prefer the model's actual context window; fall back to the user override, then 0.
      const typedResponse = response as ShowResponse & { modelinfo?: Map<string, unknown> | Record<string, unknown> };
      const modelinfo =
        (typedResponse.model_info as Map<string, unknown> | Record<string, unknown> | undefined) ??
        typedResponse.modelinfo;
      const parameters = typedResponse.parameters;
      let contextLength = getContextLengthOverride();
      if (!contextLength) {
        // Ollama exposes context_length in model_info using family-specific keys
        // (e.g. llama.context_length, qwen2.context_length, gemma.context_length).
        let infoCtx: unknown;
        if (modelinfo instanceof Map) {
          for (const [key, value] of modelinfo.entries()) {
            if (key === 'context_length' || key.endsWith('.context_length')) {
              infoCtx = value;
              break;
            }
          }
        } else if (modelinfo && typeof modelinfo === 'object') {
          for (const [key, value] of Object.entries(modelinfo)) {
            if (key === 'context_length' || key.endsWith('.context_length')) {
              infoCtx = value;
              break;
            }
          }
        }

        if (typeof infoCtx === 'number' && infoCtx > 0) {
          contextLength = infoCtx;
        } else if (parameters) {
          // Fall back to parsing the num_ctx line from the parameters string
          const match = /^num_ctx\s+(\d+)/m.exec(parameters);
          if (match) contextLength = parseInt(match[1], 10);
        }
      }

      if (this.isThinkingModel(response)) {
        this.thinkingModels.add(modelId);
      }

      return {
        id: modelId,
        name: formatModelName(modelId),
        family: '🦙 Ollama',
        version: '1.0.0',
        detail: '🦙 Ollama',
        tooltip: `🦙 Ollama • ${modelId}`,
        maxInputTokens: contextLength,
        maxOutputTokens: contextLength,
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
   * Returns true when the Ollama SDK reports that the model does not support
   * the `think` option (HTTP 400 "does not support thinking").
   */
  private isThinkingNotSupportedError(error: unknown): boolean {
    return (
      error instanceof Error &&
      error.name === 'ResponseError' &&
      error.message.toLowerCase().includes('does not support thinking')
    );
  }

  /**
   * Check if model supports tool use
   */
  private isToolModel(modelResponse: unknown): boolean {
    const response = modelResponse as Record<string, unknown>;
    const capabilities = response.capabilities;
    if (Array.isArray(capabilities) && capabilities.some(cap => String(cap).toLowerCase().includes('tool'))) {
      return true;
    }

    const template = response.template as string | undefined;
    return template ? template.includes('{{ .Tools }}') : false;
  }

  /**
   * Check if model supports extended thinking / reasoning
   */
  private isThinkingModel(modelResponse: unknown): boolean {
    const response = modelResponse as Record<string, unknown>;
    const capabilities = response.capabilities;
    return Array.isArray(capabilities) && capabilities.some(cap => String(cap).toLowerCase().includes('thinking'));
  }

  /**
   * Check if model supports vision/image inputs
   */
  private isVisionModel(modelResponse: unknown): boolean {
    const response = modelResponse as Record<string, unknown>;
    const capabilities = response.capabilities;
    if (Array.isArray(capabilities) && capabilities.some(cap => String(cap).toLowerCase().includes('vision'))) {
      return true;
    }

    if (response.projector_info) {
      return true;
    }

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

    // Create a per-request client to isolate this stream's connection from others.
    // Do NOT call abort() on cancellation — abruptly closing the HTTP connection
    // mid-generation destabilises Ollama. The isCancellationRequested check in the
    // loop below provides safe cooperative cancellation instead.
    const perRequestClient = await getOllamaClient(this.context);

    let shouldThink =
      (this.thinkingModels.has(model.id) || isThinkingModelId(model.id)) && !this.nonThinkingModels.has(model.id);

    try {
      let response: AsyncIterable<ChatResponse>;

      try {
        response = await perRequestClient.chat({
          model: model.id,
          messages: ollamaMessages,
          stream: true,
          tools,
          ...(shouldThink ? { think: true } : {}),
        });
      } catch (innerError) {
        if (shouldThink && this.isThinkingNotSupportedError(innerError)) {
          this.thinkingModels.delete(model.id);
          this.nonThinkingModels.add(model.id);
          response = await perRequestClient.chat({
            model: model.id,
            messages: ollamaMessages,
            stream: true,
            tools,
          });
        } else {
          throw innerError;
        }
      }

      let thinkingStarted = false;
      let contentStarted = false;

      for await (const chunk of response) {
        if (token.isCancellationRequested) {
          break;
        }

        // Handle thinking tokens (reasoning phase)
        if (chunk.message?.thinking) {
          if (!thinkingStarted) {
            progress.report(new LanguageModelTextPart('\n\n💭 **Thinking**\n\n'));
            thinkingStarted = true;
          }
          progress.report(new LanguageModelTextPart(chunk.message.thinking));
        }

        // Stream text chunks immediately as they arrive
        if (chunk.message?.content) {
          if (thinkingStarted && !contentStarted) {
            progress.report(new LanguageModelTextPart('\n\n---\n\n'));
            contentStarted = true;
          }
          this.outputChannel.debug?.(`[Ollama] Streaming chunk: ${chunk.message.content.substring(0, 50)}`);
          progress.report(new LanguageModelTextPart(chunk.message.content));
        }

        // Handle tool calls
        if (chunk.message?.tool_calls && Array.isArray(chunk.message.tool_calls)) {
          for (const toolCall of chunk.message.tool_calls) {
            const vsCodeId = this.generateToolCallId();
            const upstreamId =
              typeof (toolCall as { id?: unknown }).id === 'string'
                ? (toolCall as unknown as { id: string }).id
                : vsCodeId;
            this.mapToolCallId(vsCodeId, upstreamId);

            progress.report(
              new LanguageModelToolCallPart(
                vsCodeId,
                toolCall.function?.name || '',
                toolCall.function?.arguments || {},
              ),
            );
          }
        }

        // Some Ollama responses set done=true before the underlying stream closes.
        // Exit promptly so VS Code doesn't stay in a perpetual "waiting" state.
        if (chunk.done === true) {
          break;
        }
      }
    } catch (error) {
      this.outputChannel.exception('[Ollama] Chat response failed', error);
      const isConnectionError = error instanceof TypeError && error.message.includes('fetch failed');
      const message = isConnectionError
        ? 'Cannot reach Ollama server — check that it is running and accessible.'
        : error instanceof Error
          ? error.message
          : String(error);
      progress.report(new LanguageModelTextPart(`Error: ${message}`));
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

      // Extract text and images in Ollama's expected shape
      let textContent = '';
      const images: string[] = [];

      for (const part of msg.content) {
        if (part instanceof LanguageModelTextPart) {
          textContent += part.value;
        } else if (part instanceof LanguageModelDataPart) {
          const base64Data = typeof part.data === 'string' ? part.data : Buffer.from(part.data).toString('base64');
          images.push(base64Data);
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

      // Ollama requires content to be a string (images are separate field)
      if (textContent || images.length > 0) {
        ollamaMsg.content = textContent;
      }
      if (images.length > 0) {
        ollamaMsg.images = images;
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
 * Regex pattern for models that support extended thinking / reasoning.
 * Used as a fallback when the /api/show capabilities array is not yet cached.
 */
const THINKING_MODEL_PATTERN = /qwen3|qwq|deepseek-?r1|cogito|phi\d+-reasoning/i;

export function isThinkingModelId(modelId: string): boolean {
  return THINKING_MODEL_PATTERN.test(modelId);
}

/**
 * Format model name for display
 */
export function formatModelName(modelId: string): string {
  // Strip @digest suffix (e.g. :7b@1.0.0 → :7b)
  const withoutDigest = modelId.replace(/@[^:/]+$/, '');
  // Strip namespace/ prefix (e.g. m3cha/m3cha-coder → m3cha-coder)
  const withoutNamespace = withoutDigest.replace(/^[^/]+\//, '');
  // Split name and tag on the first `:` so we can format them independently
  const colonIdx = withoutNamespace.indexOf(':');
  const namePart = colonIdx === -1 ? withoutNamespace : withoutNamespace.slice(0, colonIdx);
  const tagPart = colonIdx === -1 ? '' : withoutNamespace.slice(colonIdx); // includes the `:` prefix
  // Capitalise each word in the name, replacing hyphens/underscores with spaces
  const formattedName = namePart
    .replace(/[-_]/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
  return formattedName + tagPart;
}
