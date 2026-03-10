import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Ollama, type ChatResponse, type Message, type ShowResponse } from 'ollama';
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
  Uri,
  window,
  workspace,
} from 'vscode';
import { getCloudOllamaClient, getOllamaAuthToken, getOllamaClient, getOllamaHost } from './client';
import { truncateMessages } from './contextUtils.js';
import type { DiagnosticsLogger } from './diagnostics.js';
import { reportError } from './errorHandler.js';
import {
  createXmlStreamFilter,
  dedupeXmlContextBlocksByTag,
  sanitizeNonStreamingModelOutput,
  splitLeadingXmlContextBlocks,
} from './formatting';
import { chatCompletionsOnce, initiateChatCompletionsStream } from './openaiCompat.js';
import { ollamaMessagesToOpenAICompat, ollamaToolsToOpenAICompat } from './openaiCompatMapping.js';
import { ThinkingParser } from './thinkingParser.js';
import { isToolsNotSupportedError, normalizeToolParameters } from './toolUtils.js';

const MODEL_LIST_REFRESH_MIN_INTERVAL_MS = 5_000;
const MODEL_INFO_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MODEL_SHOW_TIMEOUT_MS = 2_000;
const NON_TOOL_MODEL_MIN_PICKER_CONTEXT_TOKENS = 131_072;
const ASK_PICKER_CATEGORY = { label: 'Ask', order: 1 } as const;
const MODEL_ID_PREFIX = 'ollama:';
type LanguageModelChatInformationWithPicker = LanguageModelChatInformation & {
  category?: {
    label: string;
    order: number;
  };
  isUserSelectable?: boolean;
};

/**
 * Ollama Chat Model Provider
 */
export class OllamaChatModelProvider implements LanguageModelChatProvider<LanguageModelChatInformation> {
  private models: Map<string, LanguageModelChatInformation> = new Map();
  private modelInfoCache: Map<string, { info: LanguageModelChatInformation; updatedAtMs: number }> = new Map();
  private cachedModelList: LanguageModelChatInformation[] = [];
  private lastModelListRefreshMs = 0;
  private modelListRefreshPromise: Promise<LanguageModelChatInformation[]> | undefined;
  private modelListRefreshId = 0;
  private refreshGeneration = 0;
  private modelsChangeEventEmitter: EventEmitter<void> = new EventEmitter();
  private toolCallIdMap: Map<string, string> = new Map();
  private reverseToolCallIdMap: Map<string, string> = new Map();
  private nativeToolCallingByModelId: Map<string, boolean> = new Map();
  private visionByModelId: Map<string, boolean> = new Map();
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

    const refreshId = ++this.modelListRefreshId;
    this.modelListRefreshPromise = this.refreshModelList();
    try {
      return await this.modelListRefreshPromise;
    } finally {
      // Only clear if no newer refresh has replaced this one in the meantime.
      if (this.modelListRefreshId === refreshId) {
        this.modelListRefreshPromise = undefined;
      }
    }
  }

  private async refreshModelList(): Promise<LanguageModelChatInformation[]> {
    const now = Date.now();
    const generation = this.refreshGeneration;

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
      // Only write to the shared cache if no newer refresh has been requested
      // since this fetch started. This prevents a stale in-flight fetch from
      // overwriting the result of a faster post-pull fetch.
      if (generation === this.refreshGeneration) {
        this.cachedModelList = resolvedModels;
        this.lastModelListRefreshMs = Date.now();
      }

      return resolvedModels.length > 0 ? resolvedModels : this.cachedModelList;
    } catch (error) {
      reportError(this.outputChannel, 'Failed to fetch models', error, { showToUser: false });
      return this.cachedModelList;
    }
  }

  private pruneModelCache(activeModelNames: Set<string>): void {
    for (const modelName of this.modelInfoCache.keys()) {
      if (!activeModelNames.has(modelName)) {
        this.modelInfoCache.delete(modelName);
        this.models.delete(modelName);
        // Prune both the runtime ID and the provider-prefixed ID to prevent stale entries.
        this.nativeToolCallingByModelId.delete(modelName);
        this.nativeToolCallingByModelId.delete(this.toProviderModelId(modelName));
        this.visionByModelId.delete(modelName);
        this.visionByModelId.delete(this.toProviderModelId(modelName));
      }
    }
  }

  private clearModelCache(): void {
    this.modelInfoCache.clear();
    this.models.clear();
    this.nativeToolCallingByModelId.clear();
    this.visionByModelId.clear();
    this.thinkingModels.clear();
    this.nonThinkingModels.clear();
    this.cachedModelList = [];
    this.lastModelListRefreshMs = 0;
  }

  /**
   * Eagerly fetch all model details in the background at startup so capability
   * maps (thinkingModels, nativeToolCallingByModelId, visionByModelId) are
   * populated before the first chat request arrives.  Errors are swallowed —
   * the lazy path in provideLanguageModelChatInformation is the fallback.
   */
  prefetchModels(): void {
    this.outputChannel.info('[client] prefetching model details in background...');
    this.refreshModelList()
      .then(models => {
        this.outputChannel.info(`[client] prefetch complete: ${models.length} model(s) cached`);
      })
      .catch(err => {
        this.outputChannel.warn(
          `[client] prefetch failed (will retry on first use): ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  }

  /**
   * Invalidate the model list cache and notify VS Code to re-query.
   * Preserves per-model info cache so unchanged models don't get re-fetched.
   */
  refreshModels(): void {
    this.cachedModelList = [];
    this.lastModelListRefreshMs = 0;
    // Discard any in-flight fetch started before this refresh so the next
    // provideLanguageModelChatInformation call starts a fresh one.
    this.modelListRefreshId++;
    this.modelListRefreshPromise = undefined;
    this.refreshGeneration++;
    this.modelsChangeEventEmitter.fire();
  }

  /**
   * Build lightweight model information when detailed metadata is unavailable.
   */
  private getBaseChatModelInfo(modelId: string): LanguageModelChatInformation {
    const providerModelId = this.toProviderModelId(modelId);
    const contextLength = 0;
    const nativeToolCalling = false;
    this.nativeToolCallingByModelId.set(modelId, nativeToolCalling);
    this.nativeToolCallingByModelId.set(providerModelId, nativeToolCalling);
    this.visionByModelId.set(modelId, false);
    this.visionByModelId.set(providerModelId, false);
    return this.withModelPickerMetadata(
      {
        id: providerModelId,
        name: formatModelName(modelId),
        family: '🦙 Ollama',
        version: '1.0.0',
        detail: '🦙 Ollama',
        tooltip: `🦙 Ollama • ${modelId}`,
        maxInputTokens: this.getAdvertisedContextLength(contextLength, false),
        maxOutputTokens: this.getAdvertisedContextLength(contextLength, false),
        capabilities: {
          imageInput: false,
          toolCalling: this.getAdvertisedToolCalling(nativeToolCalling),
        },
      },
      nativeToolCalling,
    );
  }

  private toProviderModelId(modelId: string): string {
    return `${MODEL_ID_PREFIX}${modelId}`;
  }

  private toRuntimeModelId(modelId: string): string {
    return modelId.startsWith(MODEL_ID_PREFIX) ? modelId.slice(MODEL_ID_PREFIX.length) : modelId;
  }

  /**
   * VS Code can omit lower-context models from the active chat-mode picker.
   * Advertise the real context length when known, and only fall back to a
   * conservative minimum when the context length is unknown or zero so that
   * non-tool models remain available under Ask without overstating their
   * capabilities.
   */
  private getAdvertisedContextLength(contextLength: number, supportsTools: boolean): number {
    if (supportsTools) {
      return contextLength;
    }

    // For non-tool models, only use the picker minimum when the context length
    // is unknown or not set — never inflate a real known context length.
    if (contextLength && contextLength > 0) {
      return contextLength;
    }

    return NON_TOOL_MODEL_MIN_PICKER_CONTEXT_TOKENS;
  }

  /**
   * VS Code's current picker filtering can hide models that advertise
   * `toolCalling: false`, even when they are user-selectable and categorized.
   *
   * Workaround: advertise `toolCalling: true` for picker visibility.
   * Runtime tool behavior is still gated by native capability checks via
   * `nativeToolCallingByModelId` before sending tools in requests.
   */
  private getAdvertisedToolCalling(_nativeToolCalling: boolean): boolean {
    return true;
  }

  /**
   * Hint VS Code's model picker to group non-tool models under Ask.
   */
  private withModelPickerMetadata(
    info: LanguageModelChatInformation,
    nativeToolCalling: boolean,
  ): LanguageModelChatInformation {
    const selectable = {
      ...info,
      isUserSelectable: true,
    } as LanguageModelChatInformationWithPicker;

    if (nativeToolCalling) {
      return selectable;
    }

    return {
      ...selectable,
      category: ASK_PICKER_CATEGORY,
    } as LanguageModelChatInformationWithPicker;
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
      const providerModelId = this.toProviderModelId(modelId);

      // Prefer the model's actual context window; fall back to the parsed num_ctx parameter, then 0.
      const typedResponse = response as ShowResponse & { modelinfo?: Map<string, unknown> | Record<string, unknown> };
      const modelinfo =
        (typedResponse.model_info as Map<string, unknown> | Record<string, unknown> | undefined) ??
        typedResponse.modelinfo;
      const parameters = typedResponse.parameters;
      let contextLength = 0;
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

      const nativeToolCalling = this.isToolModel(response);
      const isVision = this.isVisionModel(response);
      this.nativeToolCallingByModelId.set(modelId, nativeToolCalling);
      this.nativeToolCallingByModelId.set(providerModelId, nativeToolCalling);
      this.visionByModelId.set(modelId, isVision);
      this.visionByModelId.set(providerModelId, isVision);
      const advertisedContextLength = this.getAdvertisedContextLength(contextLength, nativeToolCalling);

      return this.withModelPickerMetadata(
        {
          id: providerModelId,
          name: formatModelName(modelId),
          family: '🦙 Ollama',
          version: '1.0.0',
          detail: '🦙 Ollama',
          tooltip: `🦙 Ollama • ${modelId}`,
          maxInputTokens: advertisedContextLength,
          maxOutputTokens: advertisedContextLength,
          capabilities: {
            imageInput: isVision,
            toolCalling: this.getAdvertisedToolCalling(nativeToolCalling),
          },
        },
        nativeToolCalling,
      );
    } catch (error) {
      this.outputChannel.exception(`[client] failed to get model info for ${modelId}`, error);
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
   * Some backends (notably certain cloud-routed models) can fail with a generic
   * HTTP 500 when `think: true` is sent, instead of returning an explicit
   * "does not support thinking" message. Treat this as retryable once without
   * thinking.
   */
  private isThinkingInternalServerError(error: unknown): boolean {
    if (!(error instanceof Error) || error.name !== 'ResponseError') {
      return false;
    }
    // Match 500 error AND check for thinking context in the error message
    const is500Error =
      /(500\s+internal\s+server\s+error|"StatusCode"\s*:\s*500|"status_code"\s*:\s*500|"error"\s*:\s*"Internal Server Error")/i.test(
        error.message,
      );
    const hasThinkingContext = /think(?:ing)?/i.test(error.message);
    return is500Error && hasThinkingContext;
  }

  // normalizeToolParameters/isToolsNotSupportedError provided by src/toolUtils.ts

  private buildReducedCloudRescueMessages(messages: Message[]): Message[] {
    const system = messages.find(m => m.role === 'system');
    const lastUser = [...messages].reverse().find(m => m.role === 'user');

    const reduced: Message[] = [];
    if (system) {
      reduced.push(system);
    }
    if (lastUser) {
      reduced.push(lastUser);
    }

    return reduced.length > 0 ? reduced : messages;
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

  private mapOpenAiToolCallsToOllamaLike(toolCalls: unknown):
    | Array<{
        id?: string;
        function?: {
          name?: string;
          arguments?: Record<string, unknown>;
        };
      }>
    | undefined {
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
      return undefined;
    }

    const mapped: Array<{
      id?: string;
      function?: {
        name?: string;
        arguments?: Record<string, unknown>;
      };
    }> = [];

    for (const call of toolCalls) {
      if (!call || typeof call !== 'object') {
        continue;
      }

      const typed = call as {
        id?: unknown;
        function?: {
          name?: unknown;
          arguments?: unknown;
        };
      };

      let parsedArgs: Record<string, unknown> = {};
      if (typeof typed.function?.arguments === 'string' && typed.function.arguments.trim()) {
        try {
          const parsed = JSON.parse(typed.function.arguments);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            parsedArgs = parsed as Record<string, unknown>;
          }
        } catch {
          parsedArgs = {};
        }
      }

      mapped.push({
        id: typeof typed.id === 'string' ? typed.id : undefined,
        function: {
          name: typeof typed.function?.name === 'string' ? typed.function.name : undefined,
          arguments: parsedArgs,
        },
      });
    }

    return mapped;
  }

  private async openAiCompatStreamChat(
    runtimeModelId: string,
    messages: Message[],
    tools: Parameters<typeof this.client.chat>[0]['tools'] | undefined,
    shouldThink: boolean,
    fallbackClient: Ollama,
    signal?: AbortSignal,
  ): Promise<AsyncIterable<ChatResponse>> {
    let stream: AsyncIterable<import('./openaiCompat.js').OpenAICompatChatCompletionChunk>;
    try {
      const baseUrl = getOllamaHost();
      const authToken = await getOllamaAuthToken(this.context);

      // Use initiateChatCompletionsStream (eager fetch) so that any connection
      // or HTTP error is thrown here, allowing the catch below to fall back to
      // fallbackClient.chat() rather than surfacing during generator iteration.
      stream = await initiateChatCompletionsStream({
        baseUrl,
        authToken,
        signal,
        request: {
          model: runtimeModelId,
          messages: ollamaMessagesToOpenAICompat(messages),
          tools: ollamaToolsToOpenAICompat(tools),
          ...(shouldThink ? { think: true } : {}),
        },
      });
    } catch {
      return fallbackClient.chat({
        model: runtimeModelId,
        messages,
        stream: true,
        tools,
        ...(shouldThink ? { think: true } : {}),
      });
    }

    return (async function* (provider: OllamaChatModelProvider): AsyncGenerator<ChatResponse> {
      for await (const chunk of stream) {
        const choice = chunk.choices?.[0];
        const delta = choice?.delta;
        const content = typeof delta?.content === 'string' ? delta.content : '';
        const thinking = typeof delta?.reasoning === 'string' ? delta.reasoning : undefined;
        const mappedToolCalls = provider.mapOpenAiToolCallsToOllamaLike(delta?.tool_calls);

        const out: ChatResponse = {
          message: {
            role: 'assistant',
            content,
            ...(thinking ? { thinking } : {}),
            ...(mappedToolCalls ? { tool_calls: mappedToolCalls } : {}),
          },
          done: choice?.finish_reason != null,
        } as ChatResponse;

        yield out;
      }
    })(this);
  }

  private async openAiCompatChatOnce(
    runtimeModelId: string,
    messages: Message[],
    tools: Parameters<typeof this.client.chat>[0]['tools'] | undefined,
    shouldThink: boolean,
    fallbackClient: Ollama,
    signal?: AbortSignal,
  ): Promise<ChatResponse> {
    let response: import('./openaiCompat.js').OpenAICompatChatCompletionResponse;
    try {
      const baseUrl = getOllamaHost();
      const authToken = await getOllamaAuthToken(this.context);

      response = await chatCompletionsOnce({
        baseUrl,
        authToken,
        signal,
        request: {
          model: runtimeModelId,
          messages: ollamaMessagesToOpenAICompat(messages),
          tools: ollamaToolsToOpenAICompat(tools),
          ...(shouldThink ? { think: true } : {}),
        },
      });
    } catch {
      return (await fallbackClient.chat({
        model: runtimeModelId,
        messages,
        stream: false,
        tools,
        ...(shouldThink ? { think: true } : {}),
      })) as ChatResponse;
    }

    const choice = response.choices?.[0];
    const content = typeof choice?.message?.content === 'string' ? choice.message.content : '';
    const thinking = typeof choice?.message?.reasoning === 'string' ? choice.message.reasoning : undefined;
    const mappedToolCalls = this.mapOpenAiToolCallsToOllamaLike(choice?.message?.tool_calls);

    return {
      message: {
        role: 'assistant',
        content,
        ...(thinking ? { thinking } : {}),
        ...(mappedToolCalls ? { tool_calls: mappedToolCalls } : {}),
      },
      done: true,
    } as ChatResponse;
  }

  private async nativeSdkStreamChat(
    runtimeModelId: string,
    messages: Message[],
    tools: Parameters<typeof this.client.chat>[0]['tools'] | undefined,
    shouldThink: boolean,
    client: Ollama,
  ): Promise<AsyncIterable<ChatResponse>> {
    return client.chat({
      model: runtimeModelId,
      messages,
      stream: true,
      tools,
      ...(shouldThink ? { think: true } : {}),
    });
  }

  private async nativeSdkChatOnce(
    runtimeModelId: string,
    messages: Message[],
    tools: Parameters<typeof this.client.chat>[0]['tools'] | undefined,
    shouldThink: boolean,
    client: Ollama,
  ): Promise<ChatResponse> {
    return (await client.chat({
      model: runtimeModelId,
      messages,
      stream: false,
      tools,
      ...(shouldThink ? { think: true } : {}),
    })) as ChatResponse;
  }

  /**
   * Satisfy a VS Code Language Model API chat request by streaming through Ollama.
   *
   * ## Tool calling round-trip
   *
   * 1. `toOllamaMessages` converts the VS Code message history (including any prior
   *    `LanguageModelToolCallPart` / `LanguageModelToolResultPart` entries) to the
   *    Ollama wire format, translating VS Code tool-call IDs to the Ollama IDs via
   *    `toolCallIdMap` so that multi-turn tool conversations stay consistent.
   * 2. If the model supports native tool calling (`nativeToolCallingByModelId`) and
   *    VS Code provided tools, they are serialised as Ollama `Tool` objects.
   * 3. The chat stream is consumed chunk-by-chunk. `thinking` tokens are emitted
   *    first (behind a 💭 heading), followed by content. When a chunk contains
   *    `tool_calls` each one is emitted as a `LanguageModelToolCallPart` with a
   *    fresh VS Code ID mapped back to the model's upstream call ID.
   * 4. VS Code then invokes the referenced tools and appends the results as
   *    `LanguageModelToolResultPart` messages before calling this method again,
   *    restarting the cycle from step 1.
   *
   * ## Retry / rescue ladder
   *
   * - Thinking not supported → retry without `think: true`, evict from
   *   `thinkingModels`, add to `nonThinkingModels`.
   * - Tools not supported (`isToolsNotSupportedError`) → retry without tools.
   * - Empty stream (`!emittedOutput`) → non-stream fallback with `stream: false`.
   * - Cloud 500 after all stream retries → 4-attempt non-stream rescue ladder
   *   (reduced-context+think+tools → reduced-context+think → reduced-context →
   *   full-context).
   */
  async provideLanguageModelChatResponse(
    model: LanguageModelChatInformation,
    messages: readonly LanguageModelChatRequestMessage[],
    options: ProvideLanguageModelChatResponseOptions,
    progress: Progress<LanguageModelResponsePart>,
    token: CancellationToken,
  ): Promise<void> {
    this.clearToolCallIdMappings();
    const runtimeModelId = this.toRuntimeModelId(model.id);

    this.outputChannel.info(
      `[context] incoming request shape: ${JSON.stringify(this.summarizeIncomingRequest(messages, options), null, 2)}`,
    );

    // Convert VS Code messages to Ollama format, stripping images for non-vision models
    const supportsVision = this.visionByModelId.get(model.id) ?? this.visionByModelId.get(runtimeModelId) ?? false;
    const rawMessages = this.toOllamaMessages(messages, supportsVision) as Message[];
    const effectiveMessages = this.ensurePromptMessage(rawMessages, options);
    this.outputChannel.info(
      `[context] before truncation: ${effectiveMessages.length} messages, ${JSON.stringify(effectiveMessages, null, 2).length} chars, model.maxInputTokens=${model.maxInputTokens}`,
    );
    const ollamaMessages = truncateMessages(effectiveMessages, model.maxInputTokens);
    this.outputChannel.info(
      `[context] after truncation: ${ollamaMessages.length} messages, ${JSON.stringify(ollamaMessages, null, 2).length} chars`,
    );

    // Build tools array if supported
    let tools: Parameters<typeof this.client.chat>[0]['tools'] | undefined;
    const supportsNativeToolCalling =
      this.nativeToolCallingByModelId.get(model.id) ?? this.nativeToolCallingByModelId.get(runtimeModelId) ?? false;
    if (options.tools && options.tools.length > 0 && supportsNativeToolCalling) {
      tools = options.tools.map(tool => ({
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description || '',
          parameters: normalizeToolParameters(tool.inputSchema),
        },
      }));
    }

    // Create a per-request client to isolate this stream's connection from others.
    // Do NOT call abort() on cancellation — abruptly closing the HTTP connection
    // mid-generation destabilises Ollama. The isCancellationRequested check in the
    // loop below provides safe cooperative cancellation instead.
    const cloudModelTag = runtimeModelId.split(':')[1] ?? '';
    const isCloudModel = cloudModelTag === 'cloud' || cloudModelTag.endsWith('-cloud');
    const perRequestClient = isCloudModel
      ? await getCloudOllamaClient(this.context)
      : await getOllamaClient(this.context);

    let shouldThink =
      (this.thinkingModels.has(runtimeModelId) || isThinkingModelId(runtimeModelId)) &&
      !this.nonThinkingModels.has(runtimeModelId);
    // Preserve initial value for the rescue ladder: even if retries downgrade
    // shouldThink, the first rescue attempts should still try with think=true.
    const initialShouldThink = shouldThink;

    // Check if user wants to hide thinking content (only show header)
    const hideThinkingContent = workspace.getConfiguration('ollama').get<boolean>('hideThinkingContent', true);

    try {
      let response: AsyncIterable<ChatResponse>;
      let effectiveTools = tools;

      // Choose API path: native Ollama SDK for local models, OpenAI-compat for cloud
      const streamFn = isCloudModel
        ? (think: boolean, t?: typeof tools) =>
            this.openAiCompatStreamChat(runtimeModelId, ollamaMessages as Message[], t, think, perRequestClient)
        : (think: boolean, t?: typeof tools) =>
            this.nativeSdkStreamChat(runtimeModelId, ollamaMessages as Message[], t, think, perRequestClient);

      try {
        this.outputChannel.info(
          `[client] chat request: model=${runtimeModelId}, messages=${ollamaMessages?.length ?? 0}, tools=${tools?.length ?? 0}, think=${shouldThink}, native=${!isCloudModel}`,
        );
        this.outputChannel.info(
          `[client] full request payload:\n${JSON.stringify({ model: runtimeModelId, messages: ollamaMessages, tools, think: shouldThink }, null, 2)}`,
        );
        response = await streamFn(shouldThink, tools);
        this.outputChannel.info(`[client] chat response stream started for ${runtimeModelId}`);
      } catch (innerError) {
        this.outputChannel.exception(`[client] chat request failed for model ${runtimeModelId}`, innerError);
        if (
          shouldThink &&
          (this.isThinkingNotSupportedError(innerError) || this.isThinkingInternalServerError(innerError))
        ) {
          this.thinkingModels.delete(runtimeModelId);
          this.nonThinkingModels.add(runtimeModelId);
          shouldThink = false;
          this.outputChannel.debug(`[client] retrying without thinking support for ${runtimeModelId}`);
          try {
            response = await streamFn(false, tools);
          } catch (retryError) {
            if (
              isCloudModel &&
              tools &&
              (this.isThinkingInternalServerError(retryError) || isToolsNotSupportedError(retryError))
            ) {
              this.outputChannel.warn(
                `[client] cloud model ${runtimeModelId} failed with tools after think retry; retrying without tools`,
              );
              effectiveTools = undefined;
              response = await streamFn(false, undefined);
            } else {
              throw retryError;
            }
          }
        } else if (isCloudModel && tools && this.isThinkingInternalServerError(innerError)) {
          this.outputChannel.warn(`[client] cloud model ${runtimeModelId} failed with tools; retrying without tools`);
          effectiveTools = undefined;
          response = await streamFn(shouldThink, undefined);
        } else if (tools && isToolsNotSupportedError(innerError)) {
          this.outputChannel.warn(`[client] model ${runtimeModelId} rejected tools; retrying without tools`);
          effectiveTools = undefined;
          response = await streamFn(shouldThink, undefined);
        } else {
          throw innerError;
        }
      }

      let thinkingStarted = false;
      let contentStarted = false;
      let emittedOutput = false;
      const xmlFilter = createXmlStreamFilter();
      // Only parse <think> tags client-side on the cloud/OpenAI-compat path.
      // Native SDK path gets message.thinking pre-split by Ollama's server-side parser.
      const thinkingParser = isCloudModel && shouldThink ? new ThinkingParser() : null;

      for await (const chunk of response) {
        if (token.isCancellationRequested) {
          break;
        }

        this.outputChannel.info(`[client] raw chunk: ${JSON.stringify(chunk)}`);

        // Handle thinking tokens (reasoning phase)
        if (chunk.message?.thinking) {
          if (!thinkingStarted) {
            progress.report(new LanguageModelTextPart('\n\n💭 **Thinking**\n\n'));
            thinkingStarted = true;
            emittedOutput = true;
          }
          if (!hideThinkingContent) {
            progress.report(new LanguageModelTextPart(chunk.message.thinking));
            emittedOutput = true;
          }
        }

        // Stream text chunks — run through thinking tag parser if on cloud path
        if (chunk.message?.content) {
          let thinkingChunk = '';
          let contentChunk = chunk.message.content;

          if (thinkingParser) {
            [thinkingChunk, contentChunk] = thinkingParser.addContent(chunk.message.content);
          }

          if (thinkingChunk) {
            if (!thinkingStarted) {
              progress.report(new LanguageModelTextPart('\n\n💭 **Thinking**\n\n'));
              thinkingStarted = true;
              emittedOutput = true;
            }
            if (!hideThinkingContent) {
              progress.report(new LanguageModelTextPart(thinkingChunk));
              emittedOutput = true;
            }
          }

          if (contentChunk) {
            if (thinkingStarted && !contentStarted) {
              progress.report(new LanguageModelTextPart('\n\n---\n\n'));
              contentStarted = true;
              emittedOutput = true;
            }
            this.outputChannel.debug(`[client] streaming chunk: ${contentChunk.substring(0, 50)}`);
            const cleanContent = xmlFilter.write(contentChunk);
            if (cleanContent) {
              progress.report(new LanguageModelTextPart(cleanContent));
              emittedOutput = true;
            }
          }
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
            emittedOutput = true;
          }
        }

        // Some Ollama responses set done=true before the underlying stream closes.
        // Exit promptly so VS Code doesn't stay in a perpetual "waiting" state.
        if (chunk.done === true) {
          break;
        }
      }

      // Finalize XML filter to flush any remaining buffer
      const finalContent = xmlFilter.end();
      if (finalContent) {
        progress.report(new LanguageModelTextPart(finalContent));
        emittedOutput = true;
      }

      // Some model/server combinations can return a successful stream that emits
      // no visible content or tool calls, which causes VS Code to show
      // "Sorry, no response was returned." Recover by retrying once without
      // streaming and emit any returned content.
      if (!emittedOutput && !token.isCancellationRequested) {
        this.outputChannel.warn(`[client] stream returned no output for ${runtimeModelId}; retrying with stream=false`);

        const fallbackFn = isCloudModel
          ? (think: boolean) =>
              this.openAiCompatChatOnce(
                runtimeModelId,
                ollamaMessages as Message[],
                effectiveTools,
                think,
                perRequestClient,
              )
          : (think: boolean) =>
              this.nativeSdkChatOnce(
                runtimeModelId,
                ollamaMessages as Message[],
                effectiveTools,
                think,
                perRequestClient,
              );

        const fallback = await fallbackFn(shouldThink);
        this.outputChannel.info(`[client] non-stream fallback response: ${JSON.stringify(fallback, null, 2)}`);

        if (fallback.message?.thinking) {
          progress.report(new LanguageModelTextPart('\n\n💭 **Thinking**\n\n'));
          if (!hideThinkingContent) {
            progress.report(new LanguageModelTextPart(fallback.message.thinking));
          }
          emittedOutput = true;
        }

        if (fallback.message?.content) {
          if (fallback.message?.thinking) {
            progress.report(new LanguageModelTextPart('\n\n---\n\n'));
          }
          // Non-stream fallback is complete text; safe to format XML-like blocks.
          progress.report(new LanguageModelTextPart(sanitizeNonStreamingModelOutput(fallback.message.content)));
          emittedOutput = true;
        }

        if (!emittedOutput) {
          this.outputChannel.warn(
            `[client] fallback non-stream response also returned no content for model ${runtimeModelId}`,
          );
        }
      }
    } catch (error) {
      reportError(this.outputChannel, 'Chat response failed', error, { showToUser: false });

      if (isCloudModel && this.isThinkingInternalServerError(error) && !token.isCancellationRequested) {
        this.outputChannel.warn(
          `[client] cloud model ${runtimeModelId} returned generic 500 after streaming retries; attempting non-stream rescue`,
        );

        const rescueBaseMessages = (ollamaMessages ?? []) as Message[];

        const rescueAttempts: Array<{
          label: string;
          messages: Message[];
          think: boolean;
          tools: typeof tools;
        }> = [
          {
            label: 'reduced-context+think+tools',
            messages: this.buildReducedCloudRescueMessages(rescueBaseMessages),
            think: initialShouldThink,
            tools,
          },
          {
            label: 'reduced-context+think',
            messages: this.buildReducedCloudRescueMessages(rescueBaseMessages),
            think: initialShouldThink,
            tools: undefined,
          },
          {
            label: 'reduced-context',
            messages: this.buildReducedCloudRescueMessages(rescueBaseMessages),
            think: false,
            tools: undefined,
          },
          { label: 'full-context', messages: rescueBaseMessages, think: false, tools: undefined },
        ];

        for (const attempt of rescueAttempts) {
          try {
            const rescued = await this.openAiCompatChatOnce(
              runtimeModelId,
              attempt.messages,
              attempt.tools,
              attempt.think,
              perRequestClient,
            );

            const hasContent =
              rescued.message?.content || rescued.message?.thinking || rescued.message?.tool_calls?.length;
            if (hasContent) {
              this.outputChannel.info(
                `[client] cloud non-stream rescue (${attempt.label}) succeeded for ${runtimeModelId}`,
              );

              if (rescued.message?.thinking) {
                progress.report(new LanguageModelTextPart('\n\n\ud83d\udcad **Thinking**\n\n'));
                if (!hideThinkingContent) {
                  progress.report(new LanguageModelTextPart(rescued.message.thinking));
                }
                progress.report(new LanguageModelTextPart('\n\n---\n\n'));
              }

              if (rescued.message?.content) {
                // Non-stream rescue is complete text; safe to format XML-like blocks.
                progress.report(new LanguageModelTextPart(sanitizeNonStreamingModelOutput(rescued.message.content)));
              }

              if (rescued.message?.tool_calls && Array.isArray(rescued.message.tool_calls)) {
                for (const toolCall of rescued.message.tool_calls) {
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

              return;
            }
          } catch (rescueError) {
            this.outputChannel.warn(
              `[client] cloud non-stream rescue (${attempt.label}) failed for ${runtimeModelId}: ${String(rescueError)}`,
            );
          }
        }
      }

      const isCrashError = error instanceof Error && error.message.includes('model runner has unexpectedly stopped');
      if (isCrashError) {
        // Best-effort unload so Ollama housekeeps the dead runner — ignore any failure
        perRequestClient.generate({ model: runtimeModelId, prompt: '', keep_alive: 0, stream: false }).catch(() => {});
        const selection = await window.showErrorMessage(
          'The Ollama model runner crashed. Please check the Ollama server logs and restart if needed.',
          'Open Logs',
        );
        if (selection === 'Open Logs') {
          const logsPath = join(homedir(), '.ollama', 'logs', 'server.log');
          try {
            const document = await workspace.openTextDocument(Uri.file(logsPath));
            await window.showTextDocument(document, { preview: false });
          } catch {
            void window.showWarningMessage(
              `Could not open Ollama logs at ${logsPath}. Please check that the Ollama server is installed and logging is enabled.`,
            );
          }
        }
      }

      const isConnectionError = error instanceof TypeError && error.message.includes('fetch failed');
      // Security: `error.message` comes from Ollama `ResponseError` (the server's
      // response body) or from Node `TypeError`s for network failures.  Auth tokens
      // are only ever in HTTP *request* headers and are never echoed in server
      // responses or Node error messages, so surfacing `error.message` here is safe.
      const message = isConnectionError
        ? 'Cannot reach Ollama server — check that it is running and accessible.'
        : error instanceof Error
          ? error.message
          : String(error);
      progress.report(new LanguageModelTextPart(`Error: ${message}`));
    }
  }

  /**
   * Convert a VS Code chat history to the Ollama wire format.
   *
   * ## XML context tag extraction
   *
   * VS Code Copilot prepends structured context to the *first* user message using
   * XML-like tags (`<selection>…</selection>`, `<file>…</file>`, etc.). These are
   * privileged context injected by the IDE — not arbitrary user text — and Ollama
   * expects them as a `system` message rather than inline in the user turn.
   *
   * Algorithm:
   * 1. For each user message, if the content starts with `<`, greedily consume
   *    consecutive XML tags from the *very beginning* (index 0) **only when the
   *    tag name is in the known context-tag allowlist**. As soon as the regex
   *    match is not at position 0 (or the tag is not allowlisted), extraction
   *    stops. This prevents arbitrary user-provided XML from being elevated to
   *    system context while still preserving IDE-injected context blocks.
   * 2. Extracted blocks from all turns are collected in `systemContextParts`.
   * 3. The list is deduplicated by tag name (keeping the most-recent occurrence
   *    per tag type) to prevent accumulating stale context across turns.
   * 4. The deduplicated blocks are joined and **prepended** as a `system` message
   *    at position 0 of the Ollama message array.
   *
   * ## Vision
   *
   * `LanguageModelDataPart` images are only included when `supportsVision` is
   * true for the model. Stripped images are counted and logged.
   */
  private toOllamaMessages(
    messages: readonly LanguageModelChatRequestMessage[],
    supportsVision = true,
  ): Parameters<typeof this.client.chat>[0]['messages'] {
    const ollamaMessages: Parameters<typeof this.client.chat>[0]['messages'] = [];
    const systemContextParts: string[] = [];
    let strippedImageCount = 0;

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
          if (supportsVision) {
            const base64Data = Buffer.from(part.data).toString('base64');
            images.push(base64Data);
          } else {
            strippedImageCount++;
          }
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
          // Tool results become separate messages.
          // VS Code LanguageModelToolResultPart.content items are class instances
          // whose value property is non-enumerable, so JSON.stringify produces "[{}]".
          // Extract text values explicitly and include tool_call_id for Ollama.
          const toolContent = part.content
            .filter((c): c is LanguageModelTextPart => c instanceof LanguageModelTextPart)
            .map(c => c.value)
            .join('');
          ollamaMessages.push({
            role: 'tool',
            content: toolContent,
            tool_call_id: this.getOllamaToolCallId(part.callId),
          } as never);
        } else {
          const extractedText = this.extractTextFromUnknownInputPart(part);
          if (extractedText) {
            textContent += extractedText;
          }
        }
      }

      // Ollama requires content to be a string (images are separate field)
      if (role === 'user') {
        // Strip only *leading* allowlisted VS Code-injected XML context blocks;
        // arbitrary user-provided tags are left in user content.
        const split = splitLeadingXmlContextBlocks(textContent);
        if (split.contextBlocks.length > 0) {
          systemContextParts.push(...split.contextBlocks);
        }
        textContent = split.content;
      }
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

    const dedupedContextParts = dedupeXmlContextBlocksByTag(systemContextParts);

    if (dedupedContextParts.length > 0) {
      ollamaMessages.unshift({
        role: 'system',
        content: dedupedContextParts.join('\n\n'),
      } as never);
    }

    if (strippedImageCount > 0) {
      this.outputChannel.debug(
        `[client] stripped ${strippedImageCount} image(s) from messages (model does not support vision)`,
      );
    }

    return ollamaMessages;
  }

  private extractTextFromUnknownInputPart(part: unknown): string {
    if (typeof part === 'string') {
      return part;
    }
    if (!part || typeof part !== 'object') {
      return '';
    }

    const maybePart = part as Record<string, unknown>;

    const directStringKeys = ['value', 'text', 'prompt', 'content'];
    for (const key of directStringKeys) {
      const value = maybePart[key];
      if (typeof value === 'string') {
        return value;
      }
    }

    // Some parts can wrap text in nested objects (for example Markdown-like wrappers)
    for (const key of directStringKeys) {
      const nested = maybePart[key];
      if (nested && typeof nested === 'object') {
        const nestedValue = (nested as Record<string, unknown>).value;
        if (typeof nestedValue === 'string') {
          return nestedValue;
        }
      }
    }

    const toString = (part as { toString?: () => string }).toString;
    if (typeof toString === 'function') {
      const converted = toString.call(part);
      if (converted && converted !== '[object Object]') {
        return converted;
      }
    }

    return '';
  }

  private summarizeIncomingRequest(
    messages: readonly LanguageModelChatRequestMessage[],
    options: ProvideLanguageModelChatResponseOptions,
  ): Record<string, unknown> {
    const summarizedMessages = messages.map((message, index) => ({
      index,
      role: message.role,
      name: message.name,
      contentParts: message.content.map((part, partIndex) => this.summarizePart(part, partIndex)),
    }));

    return {
      messageCount: messages.length,
      messages: summarizedMessages,
      optionKeys: Object.keys((options as unknown as Record<string, unknown>) ?? {}),
      modelOptionKeys:
        options.modelOptions && typeof options.modelOptions === 'object'
          ? Object.keys(options.modelOptions as Record<string, unknown>)
          : [],
    };
  }

  private summarizePart(part: unknown, index: number): Record<string, unknown> {
    const partRecord = (part && typeof part === 'object' ? (part as Record<string, unknown>) : {}) as Record<
      string,
      unknown
    >;
    const ctorName =
      part && typeof part === 'object' ? (part as { constructor?: { name?: string } }).constructor?.name : typeof part;
    return {
      index,
      type: ctorName,
      keys: Object.keys(partRecord),
      sample:
        this.extractTextFromUnknownInputPart(part)?.slice(0, 120) ||
        (part instanceof LanguageModelTextPart ? part.value.slice(0, 120) : ''),
    };
  }

  private ensurePromptMessage(messages: Message[], options: ProvideLanguageModelChatResponseOptions): Message[] {
    const normalizedLastUser = this.extractMeaningfulUserText(messages);
    if (normalizedLastUser) {
      return messages;
    }

    const fallbackPrompt = this.extractPromptFromOptions(options);
    if (!fallbackPrompt) {
      return messages;
    }

    this.outputChannel.warn('[context] no meaningful user prompt in messages; appending fallback prompt from options');

    return [...messages, { role: 'user', content: fallbackPrompt } as Message];
  }

  private extractMeaningfulUserText(messages: Message[]): string {
    const userMessages = messages
      .filter(m => m.role === 'user')
      .map(m => (typeof m.content === 'string' ? m.content : ''));
    const combined = userMessages.join('\n').trim();
    if (!combined) {
      return '';
    }

    const stripped = combined
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Ignore known scaffolding blocks that can appear without the actual ask
    const onlyScaffolding =
      /^(No user preferences|Session memory|I am working in a workspace|The user's current OS)/i.test(stripped);
    return onlyScaffolding ? '' : stripped;
  }

  private extractPromptFromOptions(options: ProvideLanguageModelChatResponseOptions): string {
    const sources: unknown[] = [];
    if (options.modelOptions) {
      sources.push(options.modelOptions as unknown);
    }
    sources.push(options as unknown);

    for (const source of sources) {
      const prompt = this.deepFindPromptString(source, 0, new Set());
      if (prompt) {
        return prompt;
      }
    }

    return '';
  }

  private deepFindPromptString(value: unknown, depth: number, seen: Set<unknown>): string {
    if (depth > 5 || value == null) {
      return '';
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        return '';
      }
      const isLikelyXmlScaffold = trimmed.startsWith('<') && trimmed.includes('>');
      const looksLikeNaturalPrompt = /\s/.test(trimmed) || /[?.!,:;]/.test(trimmed);
      return isLikelyXmlScaffold || !looksLikeNaturalPrompt ? '' : trimmed;
    }
    if (typeof value !== 'object') {
      return '';
    }
    if (seen.has(value)) {
      return '';
    }
    seen.add(value);

    if (Array.isArray(value)) {
      for (const item of value) {
        const found = this.deepFindPromptString(item, depth + 1, seen);
        if (found) {
          return found;
        }
      }
      return '';
    }

    const record = value as Record<string, unknown>;
    const priorityKeys = ['prompt', 'userPrompt', 'query', 'input', 'text', 'message'];
    for (const key of priorityKeys) {
      if (key in record) {
        const found = this.deepFindPromptString(record[key], depth + 1, seen);
        if (found) {
          return found;
        }
      }
    }

    const ignoredTraversalKeys = new Set(['toolMode', 'tools']);
    for (const [key, child] of Object.entries(record)) {
      if (ignoredTraversalKeys.has(key)) {
        continue;
      }
      const found = this.deepFindPromptString(child, depth + 1, seen);
      if (found) {
        return found;
      }
    }

    return '';
  }

  /**
   * Generate a VS Code tool call ID (9 alphanumeric characters)
   */
  private generateToolCallId(): string {
    return randomUUID();
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
   * Clear tool call ID mappings at the start of each request.
   *
   * Safety in multi-turn conversations: VS Code passes the complete conversation
   * history on every call to provideLanguageModelChatResponse. When toOllamaMessages
   * reconstructs that history it reaches historical LanguageModelToolCallPart and
   * LanguageModelToolResultPart entries; both use the same vsCode call ID as the
   * fallback (getOllamaToolCallId returns vsCodeId when no mapping exists), so the
   * IDs match each other within the reconstructed context and Ollama accepts them.
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
   * Manage authentication token with status display and clear option.
   *
   * Security notes:
   * - The token input uses `password: true` so it is masked in the VS Code input box.
   * - The token is stored via `context.secrets` (VS Code SecretStorage, encrypted at
   *   rest) and never written to the output channel (only "updated"/"cleared" status
   *   messages are logged).
   * - Changing the token immediately rebuilds the Ollama client and clears the model
   *   cache so subsequent requests use the new credentials.
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
const THINKING_MODEL_PATTERN = /qwen3|qwq|deepseek-?r1|cogito|phi\d+-reasoning|kimi|thinking/i;

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
