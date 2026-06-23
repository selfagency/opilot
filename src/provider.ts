import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ProcessedOutput } from '@agentsy/core/processor';
import { LLMStreamProcessor } from '@agentsy/core/processor';
import { normalizeOllamaChatChunk } from '@agentsy/providers/normalizers';
import type { ChatResponse, Message, Ollama, ShowResponse } from 'ollama';
import * as vscode from 'vscode';
import {
  type CancellationToken,
  EventEmitter,
  type ExtensionContext,
  type LanguageModelChatInformation,
  LanguageModelChatMessageRole,
  type LanguageModelChatProvider,
  type LanguageModelChatRequestMessage,
  LanguageModelDataPart,
  type LanguageModelResponsePart,
  LanguageModelTextPart,
  LanguageModelToolCallPart,
  LanguageModelToolResultPart,
  type Progress,
  type ProvideLanguageModelChatResponseOptions,
  Uri,
  window,
  workspace
} from 'vscode';
import { nativeSdkChatOnce, nativeSdkStreamChat, openAiCompatChatOnce, openAiCompatStreamChat } from './chat-utils.js';
import {
  fetchOllamaCloudCatalog,
  getCloudOllamaClient,
  getOllamaAuthToken,
  getOllamaClient,
  getOllamaHost
} from './client';
import { compressToContext } from './compression.js';
import { BASE_SYSTEM_PROMPT, detectsRepetition, resolveContextLimit } from './context-utils.js';
import type { DiagnosticsLogger } from './diagnostics.js';
import { reportError } from './error-handler.js';
import {
  appendToBlockquote,
  dedupeXmlContextBlocksByTag,
  sanitizeNonStreamingModelOutput,
  splitLeadingXmlContextBlocks
} from './formatting.js';
import {
  getModelOptionsForModel,
  type ModelOptionOverrides,
  type ModelSettingsStore,
  type ThinkValue
} from './model-settings.js';
import { getSetting } from './settings.js';
import { isToolsNotSupportedError, normalizeToolParameters } from './tool-utils.js';

const MODEL_LIST_REFRESH_MIN_INTERVAL_MS = 5000;
const MODEL_INFO_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MODEL_SHOW_TIMEOUT_MS = 2000;
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
  private readonly models: Map<string, LanguageModelChatInformation> = new Map();
  private readonly modelInfoCache: Map<string, { info: LanguageModelChatInformation; updatedAtMs: number }> = new Map();
  private cachedModelList: LanguageModelChatInformation[] = [];
  private lastModelListRefreshMs = 0;
  private modelListRefreshPromise: Promise<LanguageModelChatInformation[]> | undefined;
  private modelListRefreshId = 0;
  private refreshGeneration = 0;
  private readonly modelsChangeEventEmitter: EventEmitter<void> = new EventEmitter();
  private readonly toolCallIdMap: Map<string, string> = new Map();
  private readonly reverseToolCallIdMap: Map<string, string> = new Map();
  private readonly nativeToolCallingByModelId: Map<string, boolean> = new Map();
  private readonly visionByModelId: Map<string, boolean> = new Map();
  private readonly thinkingModels = new Set<string>();
  private readonly nonThinkingModels = new Set<string>();

  readonly onDidChangeLanguageModelChatInformation = this.modelsChangeEventEmitter.event;

  readonly context: ExtensionContext;
  private client: Ollama;
  private readonly outputChannel: DiagnosticsLogger;
  private readonly getModelSettings?: () => ModelSettingsStore;

  constructor(
    context: ExtensionContext,
    client: Ollama,
    outputChannel: DiagnosticsLogger,
    getModelSettings?: () => ModelSettingsStore
  ) {
    this.context = context;
    this.client = client;
    this.outputChannel = outputChannel;
    this.getModelSettings = getModelSettings;
  }

  /**
   * Provide information about available chat models
   */
  async provideLanguageModelChatInformation(
    options: { silent: boolean },
    _token: CancellationToken
  ): Promise<LanguageModelChatInformation[]> {
    const now = Date.now();
    if (this.cachedModelList.length > 0 && now - this.lastModelListRefreshMs < MODEL_LIST_REFRESH_MIN_INTERVAL_MS) {
      return this.cachedModelList;
    }

    // When silent, skip refresh if we're still within the throttle window
    // and have cached data. This avoids unnecessary network calls during
    // background discovery without blocking legitimate refreshes.
    if (
      options.silent &&
      this.cachedModelList.length > 0 &&
      now - this.lastModelListRefreshMs < MODEL_LIST_REFRESH_MIN_INTERVAL_MS
    ) {
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
        })
      );

      const resolvedModels = models.filter((model): model is LanguageModelChatInformation => Boolean(model));

      // Append cloud models when an API key is present so they appear in the
      // VS Code Language Model picker alongside local models.
      const authToken = await getOllamaAuthToken(this.context);
      const cloudModels: LanguageModelChatInformation[] = [];
      if (authToken) {
        const cloudNames = await fetchOllamaCloudCatalog(authToken);
        for (const name of cloudNames) {
          const cloudId = name.endsWith(':cloud') ? name : `${name}:cloud`;
          const info = this.getBaseChatModelInfo(cloudId);
          if (isThinkingModelId(cloudId)) {
            this.thinkingModels.add(cloudId);
          }
          cloudModels.push(info);
        }
      }

      const allModels = resolvedModels.concat(cloudModels);

      // Only write to the shared cache if no newer refresh has been requested
      // since this fetch started. This prevents a stale in-flight fetch from
      // overwriting the result of a faster post-pull fetch.
      if (generation === this.refreshGeneration) {
        this.cachedModelList = allModels;
        this.lastModelListRefreshMs = Date.now();
      }

      return allModels.length > 0 ? allModels : this.cachedModelList;
    } catch (error) {
      reportError(this.outputChannel, 'Failed to fetch models', error, {
        showToUser: false
      });
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
          `[client] prefetch failed (will retry on first use): ${err instanceof Error ? err.message : String(err)}`
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
        // Output tokens should not mirror picker-context fallback values.
        // Use a conservative default when model metadata is unavailable.
        maxOutputTokens: 4096,
        capabilities: {
          imageInput: false,
          toolCalling: this.getAdvertisedToolCalling(nativeToolCalling)
        }
      },
      nativeToolCalling
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
    nativeToolCalling: boolean
  ): LanguageModelChatInformation {
    const selectable = {
      ...info,
      isUserSelectable: true
    } as LanguageModelChatInformationWithPicker;

    if (nativeToolCalling) {
      return selectable;
    }

    return {
      ...selectable,
      category: ASK_PICKER_CATEGORY
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
        new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), MODEL_SHOW_TIMEOUT_MS))
      ]);

      return timed ?? fallback;
    } catch {
      return fallback;
    }
  }

  /**
   * Get information about a specific model
   */
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: model-info extraction intentionally supports many Ollama shapes.
  private async getChatModelInfo(modelId: string): Promise<LanguageModelChatInformation | undefined> {
    try {
      const response = await this.client.show({ model: modelId });
      const providerModelId = this.toProviderModelId(modelId);

      // Prefer the model's actual context window; fall back to the parsed num_ctx parameter, then 0.
      const typedResponse = response as ShowResponse & {
        modelinfo?: Map<string, unknown> | Record<string, unknown>;
      };
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
          if (match) {
            contextLength = Number.parseInt(match[1], 10);
          }
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

      // Parse num_predict for output token limit (independent of context window).
      let maxOutputTokens = 4096;
      if (parameters) {
        const predictMatch = /num_predict\s+(-?\d+)/m.exec(parameters);
        if (predictMatch) {
          const val = Number.parseInt(predictMatch[1], 10);
          maxOutputTokens = val > 0 ? val : advertisedContextLength;
        }
      }

      return this.withModelPickerMetadata(
        {
          id: providerModelId,
          name: formatModelName(modelId),
          family: '🦙 Ollama',
          version: '1.0.0',
          detail: '🦙 Ollama',
          tooltip: `🦙 Ollama • ${modelId}`,
          maxInputTokens: advertisedContextLength,
          maxOutputTokens,
          capabilities: {
            imageInput: isVision,
            toolCalling: this.getAdvertisedToolCalling(nativeToolCalling)
          }
        },
        nativeToolCalling
      );
    } catch (error) {
      this.outputChannel.exception(`[client] failed to get model info for ${modelId}`, error);
      return;
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
        error.message
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
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: chat orchestration intentionally centralizes many fallback branches.
  async provideLanguageModelChatResponse(
    model: LanguageModelChatInformation,
    messages: readonly LanguageModelChatRequestMessage[],
    options: ProvideLanguageModelChatResponseOptions,
    progress: Progress<LanguageModelResponsePart>,
    token: CancellationToken
  ): Promise<void> {
    this.clearToolCallIdMappings();
    const runtimeModelId = this.toRuntimeModelId(model.id);

    this.outputChannel.info(
      `[context] incoming request shape: ${JSON.stringify(this.summarizeIncomingRequest(messages, options), null, 2)}`
    );

    // Convert VS Code messages to Ollama format, stripping images for non-vision models
    const supportsVision = this.visionByModelId.get(model.id) ?? this.visionByModelId.get(runtimeModelId) ?? false;
    const rawMessages = this.toOllamaMessages(messages, supportsVision) as Message[];
    const effectiveMessages = rawMessages;
    this.outputChannel.info(
      `[context] before truncation: ${effectiveMessages.length} messages, ${JSON.stringify(effectiveMessages, null, 2).length} chars, model.maxInputTokens=${model.maxInputTokens}`
    );
    const modelSettings = this.getModelSettings?.();
    const modelOptions: ModelOptionOverrides = modelSettings
      ? getModelOptionsForModel(modelSettings, runtimeModelId)
      : {};
    const maxInputTokens = resolveContextLimit(
      model.maxInputTokens ?? 0,
      modelOptions.num_ctx,
      getSetting<number>('maxContextTokens', 0)
    );
    const ollamaMessages = await compressToContext(effectiveMessages, maxInputTokens);
    this.outputChannel.info(
      `[context] after truncation: ${ollamaMessages.length} messages, ${JSON.stringify(ollamaMessages, null, 2).length} chars`
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
          parameters: normalizeToolParameters(tool.inputSchema)
        }
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

    const modelThinks =
      (this.thinkingModels.has(runtimeModelId) || isThinkingModelId(runtimeModelId)) &&
      !this.nonThinkingModels.has(runtimeModelId);
    // Resolve the think value from model settings or fall back to the capability flag.
    // GPT-OSS accepts 'low' | 'medium' | 'high' — map `true` to `'medium'` for those models.
    const modelThinkSetting = modelOptions.think;
    const isGptOss = /gpt-oss/i.test(runtimeModelId);
    let effectiveThink: ThinkValue | undefined;
    if (modelThinkSetting !== undefined) {
      effectiveThink = modelThinkSetting;
    } else if (modelThinks && isGptOss) {
      effectiveThink = 'medium';
    } else if (modelThinks) {
      effectiveThink = true;
    }
    // Preserve initial value for the rescue ladder: even if retries downgrade
    // effectiveThink, the first rescue attempts should still try with think=true.
    const initialShouldThink = Boolean(effectiveThink);
    let shouldThink = Boolean(effectiveThink);

    // Check if user wants to hide thinking content (only show header)
    const hideThinkingContent = getSetting<boolean>('hideThinkingContent', false);

    // EXPERIMENTAL: Use VS Code's native collapsible "Thinking" part via the
    // proposed LanguageModelThinkingPart API instead of the manual blockquote.
    const useNativeThinkingPart = getSetting<boolean>('experimental.nativeThinkingPart', false);

    try {
      let response: AsyncIterable<ChatResponse>;
      let effectiveTools = tools;

      const resolveCloudTransport = async (): Promise<{ baseUrl: string; authToken?: string } | undefined> => {
        if (!isCloudModel) {
          return;
        }
        try {
          return {
            baseUrl: getOllamaHost(),
            authToken: await getOllamaAuthToken(this.context)
          };
        } catch {
          return;
        }
      };

      // Choose API path: native Ollama SDK for local models, OpenAI-compat for cloud
      const streamFn = isCloudModel
        ? async (thinkVal: ThinkValue | undefined, t?: typeof tools) => {
            const transport = await resolveCloudTransport();
            if (!transport) {
              return nativeSdkStreamChat({
                modelId: runtimeModelId,
                messages: ollamaMessages as Message[],
                tools: t,
                think: thinkVal,
                effectiveClient: perRequestClient,
                modelOptions
              });
            }
            return openAiCompatStreamChat({
              modelId: runtimeModelId,
              messages: ollamaMessages as Message[],
              tools: t,
              think: thinkVal,
              effectiveClient: perRequestClient,
              baseUrl: transport.baseUrl,
              authToken: transport.authToken,
              modelOptions
            });
          }
        : (thinkVal: ThinkValue | undefined, t?: typeof tools) =>
            nativeSdkStreamChat({
              modelId: runtimeModelId,
              messages: ollamaMessages as Message[],
              tools: t,
              think: thinkVal,
              effectiveClient: perRequestClient,
              modelOptions
            });

      try {
        this.outputChannel.debug(
          `[client] chat request: model=${runtimeModelId}, messages=${ollamaMessages?.length ?? 0}, tools=${tools?.length ?? 0}, think=${shouldThink}, native=${!isCloudModel}`
        );
        this.outputChannel.debug(
          `[client] full request payload:\n${JSON.stringify({ model: runtimeModelId, messages: ollamaMessages, tools, think: shouldThink }, null, 2)}`
        );
        response = await streamFn(effectiveThink, tools);
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
          effectiveThink = undefined;
          this.outputChannel.debug(`[client] retrying without thinking support for ${runtimeModelId}`);
          try {
            response = await streamFn(undefined, tools);
          } catch (retryError) {
            if (
              isCloudModel &&
              tools &&
              (this.isThinkingInternalServerError(retryError) || isToolsNotSupportedError(retryError))
            ) {
              this.outputChannel.warn(
                `[client] cloud model ${runtimeModelId} failed with tools after think retry; retrying without tools`
              );
              effectiveTools = undefined;
              response = await streamFn(effectiveThink);
            } else {
              throw retryError;
            }
          }
        } else if (isCloudModel && tools && this.isThinkingInternalServerError(innerError)) {
          this.outputChannel.warn(`[client] cloud model ${runtimeModelId} failed with tools; retrying without tools`);
          effectiveTools = undefined;
          response = await streamFn(effectiveThink);
        } else if (tools && isToolsNotSupportedError(innerError)) {
          this.outputChannel.warn(`[client] model ${runtimeModelId} rejected tools; retrying without tools`);
          effectiveTools = undefined;
          response = await streamFn(effectiveThink);
        } else {
          throw innerError;
        }
      }

      let thinkingStarted = false;
      let thinkingLineStart = true;
      let contentStarted = false;
      let emittedOutput = false;
      let responseBuffer = '';
      const repSensitivity = getSetting<'off' | 'conservative' | 'moderate'>('repetitionDetection', 'conservative');
      const processor = new LLMStreamProcessor({
        parseThinkTags: shouldThink,
        scrubContextTags: true,
        accumulateNativeToolCalls: true,
        modelId: runtimeModelId,
        onWarning: (msg, ctx) => {
          const ctxSuffix = ctx ? ` ${JSON.stringify(ctx)}` : '';
          this.outputChannel.warn(`[client] processor: ${msg}${ctxSuffix}`);
        }
      });

      for await (const chunk of response) {
        if (token.isCancellationRequested) {
          break;
        }

        this.outputChannel.info(`[client] raw chunk: ${JSON.stringify(chunk)}`);

        // Detect mid-stream error chunks (NDJSON {"error":"..."}).
        // The Ollama SDK may surface these as thrown exceptions during iteration,
        // but we check explicitly in case the error arrives as a regular chunk.
        const errorField = (chunk as { error?: unknown }).error;
        if (errorField) {
          const errorText =
            typeof errorField === 'object' && errorField !== null ? JSON.stringify(errorField) : String(errorField);
          this.outputChannel.error(`[client] stream error: ${errorText}`);
          progress.report(new LanguageModelTextPart(`\n\n*Error: ${errorText}*`));
          emittedOutput ||= true;
          break;
        }

        // Handle thinking tokens (reasoning phase) — Ollama server pre-splits these
        if (chunk.message?.thinking) {
          const thinkingPartValue = chunk.message.thinking;
          if (!(thinkingStarted || useNativeThinkingPart)) {
            progress.report(new LanguageModelTextPart('\n\n> 💭 **Thinking**\n>\n'));
            thinkingStarted = true;
            thinkingLineStart = true;
            emittedOutput ||= true;
          } else if (!thinkingStarted) {
            thinkingStarted = true;
            emittedOutput ||= true;
          }
          if (!(hideThinkingContent || useNativeThinkingPart)) {
            const formatted = appendToBlockquote(thinkingPartValue, thinkingLineStart);
            thinkingLineStart = false;
            progress.report(new LanguageModelTextPart(formatted));
            emittedOutput ||= true;
          } else if (useNativeThinkingPart) {
            // biome-ignore lint/suspicious/noExplicitAny: experimental proposed API
            progress.report(new (vscode as any).LanguageModelThinkingPart(thinkingPartValue));
            emittedOutput ||= true;
          }
        }

        // Feed through normalizer → LLMStreamProcessor for XML scrubbing,
        // <think> tag parsing, and tool call accumulation
        if (chunk.message?.content || chunk.message?.tool_calls) {
          const normalized = normalizeOllamaChatChunk(chunk);
          if (normalized) {
            const output: ProcessedOutput = processor.process(normalized.chunk);

            // Handle thinking extracted from <think> tags in content
            if (output.thinking && !useNativeThinkingPart) {
              if (!thinkingStarted) {
                progress.report(new LanguageModelTextPart('\n\n> 💭 **Thinking**\n>\n'));
                thinkingStarted = true;
                thinkingLineStart = true;
                emittedOutput ||= true;
              }
              if (!hideThinkingContent) {
                // When thinkingLineStart is false the thinking content from the
                // processor may not begin with a blockquote marker, so prefix with
                // `> ` to keep it inside the blockquote block.
                const formatted = appendToBlockquote(output.thinking, thinkingLineStart);
                thinkingLineStart = false;
                progress.report(new LanguageModelTextPart(formatted));
                emittedOutput ||= true;
              }
            } else if (output.thinking && useNativeThinkingPart) {
              if (!thinkingStarted) {
                thinkingStarted = true;
                emittedOutput ||= true;
              }
              // biome-ignore lint/suspicious/noExplicitAny: experimental proposed API
              progress.report(new (vscode as any).LanguageModelThinkingPart(output.thinking));
              emittedOutput ||= true;
            }

            // Handle content (already XML-scrubbed by LLMStreamProcessor)
            if (output.content) {
              // When using the native thinking part, VS Code handles the visual
              // separation between thinking and response; no manual separator needed.
              if (thinkingStarted && !contentStarted) {
                if (!useNativeThinkingPart) {
                  progress.report(new LanguageModelTextPart('\n\n\n\n'));
                  emittedOutput ||= true;
                }
                contentStarted = true;
              }
              this.outputChannel.debug(`[client] streaming chunk: ${output.content.slice(0, 50)}`);
              progress.report(new LanguageModelTextPart(output.content));
              emittedOutput ||= true;
              responseBuffer = (responseBuffer + output.content).slice(-600);
              if (detectsRepetition(responseBuffer, repSensitivity)) {
                this.outputChannel.warn(`[client] repetition detected for ${runtimeModelId}; stopping stream`);
                progress.report(new LanguageModelTextPart('\n\n*[Stopped: repetition detected]*'));
                break;
              }
            }

            // Handle accumulated tool calls
            if (output.toolCalls.length > 0) {
              for (const call of output.toolCalls) {
                const vsCodeId = this.generateToolCallId();
                const upstreamId = call.id || vsCodeId;
                this.mapToolCallId(vsCodeId, upstreamId);
                progress.report(new LanguageModelToolCallPart(vsCodeId, call.name, call.parameters));
                emittedOutput ||= true;
              }
            }

            if (output.done) {
              break;
            }
          }
        }

        // Some Ollama responses set done=true before the underlying stream closes.
        // Exit promptly so VS Code doesn't stay in a perpetual "waiting" state.
        if (chunk.done === true) {
          break;
        }
      }

      // Flush any remaining buffered content from the processor
      const final: ProcessedOutput = processor.flush();
      if (final.content) {
        if (thinkingStarted && !contentStarted) {
          progress.report(new LanguageModelTextPart('\n\n\n\n'));
          emittedOutput ||= true;
        }
        progress.report(new LanguageModelTextPart(final.content));
        emittedOutput ||= true;
      }

      // Some model/server combinations can return a successful stream that emits
      // no visible content or tool calls, which causes VS Code to show
      // "Sorry, no response was returned." Recover by retrying once without
      // streaming and emit any returned content.
      if (!(emittedOutput || token.isCancellationRequested)) {
        this.outputChannel.warn(`[client] stream returned no output for ${runtimeModelId}; retrying with stream=false`);

        const fallbackFn = isCloudModel
          ? async (thinkVal: ThinkValue | undefined) => {
              const transport = await resolveCloudTransport();
              if (!transport) {
                return nativeSdkChatOnce({
                  modelId: runtimeModelId,
                  messages: ollamaMessages as Message[],
                  tools: effectiveTools,
                  think: thinkVal,
                  effectiveClient: perRequestClient,
                  modelOptions
                });
              }
              return openAiCompatChatOnce({
                modelId: runtimeModelId,
                messages: ollamaMessages as Message[],
                tools: effectiveTools,
                think: thinkVal,
                effectiveClient: perRequestClient,
                baseUrl: transport.baseUrl,
                authToken: transport.authToken,
                modelOptions
              });
            }
          : (thinkVal: ThinkValue | undefined) =>
              nativeSdkChatOnce({
                modelId: runtimeModelId,
                messages: ollamaMessages as Message[],
                tools: effectiveTools,
                think: thinkVal,
                effectiveClient: perRequestClient,
                modelOptions
              });

        const fallback = await fallbackFn(effectiveThink);
        this.outputChannel.info(`[client] non-stream fallback response: ${JSON.stringify(fallback, null, 2)}`);

        if (fallback.message?.thinking && !hideThinkingContent) {
          const formatted = appendToBlockquote(fallback.message.thinking, true);
          progress.report(new LanguageModelTextPart(`\n\n> 💭 **Thinking**\n>\n${formatted}\n\n`));
          emittedOutput = true;
        }

        if (fallback.message?.content) {
          // Non-stream fallback is complete text; safe to format XML-like blocks.
          progress.report(new LanguageModelTextPart(sanitizeNonStreamingModelOutput(fallback.message.content)));
          emittedOutput = true;
        }

        if (!emittedOutput) {
          this.outputChannel.warn(
            `[client] fallback non-stream response also returned no content for model ${runtimeModelId}`
          );
        }
      }
    } catch (error) {
      reportError(this.outputChannel, 'Chat response failed', error, {
        showToUser: false
      });

      if (isCloudModel && this.isThinkingInternalServerError(error) && !token.isCancellationRequested) {
        this.outputChannel.warn(
          `[client] cloud model ${runtimeModelId} returned generic 500 after streaming retries; attempting non-stream rescue`
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
            tools
          },
          {
            label: 'reduced-context+think',
            messages: this.buildReducedCloudRescueMessages(rescueBaseMessages),
            think: initialShouldThink,
            tools: undefined
          },
          {
            label: 'reduced-context',
            messages: this.buildReducedCloudRescueMessages(rescueBaseMessages),
            think: false,
            tools: undefined
          },
          {
            label: 'full-context',
            messages: rescueBaseMessages,
            think: false,
            tools: undefined
          }
        ];

        for (const attempt of rescueAttempts) {
          try {
            const rescued = await nativeSdkChatOnce({
              modelId: runtimeModelId,
              messages: attempt.messages,
              tools: attempt.tools,
              think: attempt.think,
              effectiveClient: perRequestClient,
              modelOptions
            });

            const hasContent =
              rescued.message?.content || rescued.message?.thinking || rescued.message?.tool_calls?.length;
            if (hasContent) {
              this.outputChannel.info(
                `[client] cloud non-stream rescue (${attempt.label}) succeeded for ${runtimeModelId}`
              );

              if (rescued.message?.thinking && !hideThinkingContent) {
                const formatted = appendToBlockquote(rescued.message.thinking, true);
                progress.report(new LanguageModelTextPart(`\n\n> 💭 **Thinking**\n>\n${formatted}\n\n`));
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
                      toolCall.function?.arguments || {}
                    )
                  );
                }
              }

              return;
            }
          } catch (rescueError) {
            this.outputChannel.warn(
              `[client] cloud non-stream rescue (${attempt.label}) failed for ${runtimeModelId}: ${String(rescueError)}`
            );
          }
        }
      }

      const isCrashError = error instanceof Error && error.message.includes('model runner has unexpectedly stopped');
      if (isCrashError) {
        // Best-effort unload so Ollama housekeeps the dead runner — ignore any failure
        perRequestClient
          .generate({
            model: runtimeModelId,
            prompt: '',
            keep_alive: 0,
            stream: false
          })
          .catch(() => {
            /* fire-and-forget — model unload on crash */
          });
        const selection = await window.showErrorMessage(
          'The Ollama model runner crashed. Please check the Ollama server logs and restart if needed.',
          'Open Logs'
        );
        if (selection === 'Open Logs') {
          const logsPath = join(homedir(), '.ollama', 'logs', 'server.log');
          try {
            const document = await workspace.openTextDocument(Uri.file(logsPath));
            await window.showTextDocument(document, { preview: false });
          } catch {
            void window.showWarningMessage(
              `Could not open Ollama logs at ${logsPath}. Please check that the Ollama server is installed and logging is enabled.`
            );
          }
        }
      }

      const isConnectionError = error instanceof TypeError && error.message.includes('fetch failed');
      // Security: `error.message` comes from Ollama `ResponseError` (the server's
      // response body) or from Node `TypeError`s for network failures.  Auth tokens
      // are only ever in HTTP *request* headers and are never echoed in server
      // responses or Node error messages, so surfacing `error.message` here is safe.
      let message: string;
      if (isConnectionError) {
        message = 'Cannot reach Ollama server — check that it is running and accessible.';
      } else if (error instanceof Error) {
        message = error.message;
      } else {
        message = String(error);
      }
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
   * `LanguageModelDataPart` is a generic binary carrier in the VS Code API, so
   * only `image/*` MIME parts are forwarded via Ollama's `images` field. Text
   * and JSON data parts are decoded back into inline text content. Unsupported
   * binary parts are stripped and logged.
   */
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: message conversion intentionally handles many VS Code part types.
  private toOllamaMessages(
    messages: readonly LanguageModelChatRequestMessage[],
    supportsVision = true
  ): Parameters<typeof this.client.chat>[0]['messages'] {
    const ollamaMessages: Parameters<typeof this.client.chat>[0]['messages'] = [];
    const systemContextParts: string[] = [];
    let strippedImageCount = 0;
    let strippedBinaryDataCount = 0;

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
          if (this.isImageMimeType(part.mimeType)) {
            if (supportsVision) {
              const base64Data = Buffer.from(part.data).toString('base64');
              images.push(base64Data);
            } else {
              strippedImageCount++;
            }
          } else {
            const extractedText = this.extractTextFromDataPart(part);
            if (extractedText === undefined) {
              strippedBinaryDataCount++;
            } else {
              textContent += extractedText;
            }
          }
        } else if (part instanceof LanguageModelToolCallPart) {
          ollamaMsg.tool_calls = ollamaMsg.tool_calls || [];
          (ollamaMsg.tool_calls as Record<string, unknown>[]).push({
            id: this.getOllamaToolCallId(part.callId),
            function: {
              name: part.name,
              arguments: part.input
            }
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
            tool_call_id: this.getOllamaToolCallId(part.callId)
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
        content: `${BASE_SYSTEM_PROMPT}\n\n${dedupedContextParts.join('\n\n')}`
      });
    } else {
      ollamaMessages.unshift({
        role: 'system' as const,
        content: BASE_SYSTEM_PROMPT
      });
    }

    if (strippedImageCount > 0) {
      this.outputChannel.debug(
        `[client] stripped ${strippedImageCount} image(s) from messages (model does not support vision)`
      );
    }

    if (strippedBinaryDataCount > 0) {
      this.outputChannel.debug(
        `[client] stripped ${strippedBinaryDataCount} non-image binary data part(s) from messages`
      );
    }

    return ollamaMessages;
  }

  private isImageMimeType(mimeType: string | undefined): boolean {
    return this.normalizeMimeType(mimeType).startsWith('image/');
  }

  private isTextualMimeType(mimeType: string | undefined): boolean {
    const normalized = this.normalizeMimeType(mimeType);
    return (
      normalized.startsWith('text/') ||
      normalized === 'application/json' ||
      normalized.endsWith('+json') ||
      normalized === 'application/xml' ||
      normalized.endsWith('+xml')
    );
  }

  private normalizeMimeType(mimeType: string | undefined): string {
    return (mimeType ?? '').split(';', 1)[0]?.trim().toLowerCase();
  }

  private extractTextFromDataPart(part: LanguageModelDataPart): string | undefined {
    if (!this.isTextualMimeType(part.mimeType)) {
      return;
    }

    try {
      return new TextDecoder('utf-8').decode(part.data);
    } catch {
      return;
    }
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

    const partToString = (part as { toString?: () => string }).toString;
    if (typeof partToString === 'function') {
      const converted = partToString.call(part);
      if (converted && converted !== '[object Object]') {
        return converted;
      }
    }

    return '';
  }

  private summarizeIncomingRequest(
    messages: readonly LanguageModelChatRequestMessage[],
    options: ProvideLanguageModelChatResponseOptions
  ): Record<string, unknown> {
    const summarizedMessages = messages.map((message, index) => ({
      index,
      role: message.role,
      name: message.name,
      contentParts: message.content.map((part, partIndex) => this.summarizePart(part, partIndex))
    }));

    return {
      messageCount: messages.length,
      messages: summarizedMessages,
      optionKeys: Object.keys(options as unknown as Record<string, unknown>),
      modelOptionKeys:
        options.modelOptions && typeof options.modelOptions === 'object'
          ? Object.keys(options.modelOptions as Record<string, unknown>)
          : []
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
      mimeType: part instanceof LanguageModelDataPart ? part.mimeType : undefined,
      sample:
        this.extractTextFromUnknownInputPart(part)?.slice(0, 120) ||
        (part instanceof LanguageModelTextPart ? part.value.slice(0, 120) : '')
    };
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

  /** Bounded FIFO cache for token counts, keyed by `${modelId}::${content}`. */
  private static readonly TOKEN_COUNT_CACHE_MAX = 1000;
  private readonly tokenCountCache = new Map<string, number>();

  /**
   * Provide token count estimate using Ollama's `/api/tokenize` with a
   * chars/4 heuristic fallback.
   */
  provideTokenCount(
    model: LanguageModelChatInformation,
    text: string | LanguageModelChatRequestMessage,
    token: CancellationToken
  ): Promise<number> {
    const textContent = extractTextFromTokenCountInput(text);
    if (!textContent) {
      return Promise.resolve(0);
    }

    const runtimeModelId = this.toRuntimeModelId(model.id);
    const cacheKey = `${runtimeModelId}::${textContent}`;
    const cached = this.tokenCountCache.get(cacheKey);
    if (cached !== undefined) {
      return Promise.resolve(cached);
    }

    return this.tokenizeWithFallback(runtimeModelId, textContent, cacheKey, token);
  }

  private async tokenizeWithFallback(
    runtimeModelId: string,
    textContent: string,
    cacheKey: string,
    token: CancellationToken
  ): Promise<number> {
    try {
      if (token.isCancellationRequested) {
        return this.cacheAndReturn(cacheKey, this.heuristicTokenCount(textContent));
      }

      const host = getOllamaHost();
      const url = `${host.replace(/\/+$/, '')}/api/tokenize`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: runtimeModelId, prompt: textContent })
      });

      if (response.ok) {
        const data = (await response.json()) as { tokens?: unknown[] };
        const count =
          Array.isArray(data.tokens) && data.tokens.length > 0
            ? data.tokens.length
            : this.heuristicTokenCount(textContent);
        return this.cacheAndReturn(cacheKey, count);
      }
    } catch {
      // Fall through to heuristic on any error
    }

    return this.cacheAndReturn(cacheKey, this.heuristicTokenCount(textContent));
  }

  private heuristicTokenCount(text: string): number {
    return Math.ceil(text.length / 4);
  }

  private cacheAndReturn(cacheKey: string, count: number): number {
    if (this.tokenCountCache.size >= OllamaChatModelProvider.TOKEN_COUNT_CACHE_MAX) {
      const firstKey = this.tokenCountCache.keys().next().value;
      if (firstKey !== undefined) {
        this.tokenCountCache.delete(firstKey);
      }
    }
    this.tokenCountCache.set(cacheKey, count);
    return count;
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
        {
          label: `${status}`,
          description: 'Current authentication status',
          kind: -1
        },
        { label: 'Set Token', description: 'Enter a new authentication token' },
        ...(existingToken
          ? [
              {
                label: 'Clear Token',
                description: 'Remove stored authentication'
              }
            ]
          : [])
      ],
      { matchOnDescription: true, ignoreFocusOut: true }
    );

    if (!action) {
      return;
    }

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
        ignoreFocusOut: true
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
/**
 * Extract plain text from the union type accepted by provideTokenCount.
 */
function extractTextFromTokenCountInput(text: string | LanguageModelChatRequestMessage): string {
  if (typeof text === 'string') {
    return text;
  }
  return text.content
    .map(part => {
      if (part instanceof LanguageModelTextPart) {
        return part.value;
      }
      if (part instanceof LanguageModelToolCallPart) {
        return part.name + JSON.stringify(part.input);
      }
      if (part instanceof LanguageModelToolResultPart) {
        return String(part.content);
      }
      return '';
    })
    .join('');
}

const THINKING_MODEL_PATTERN = /qwen3|qwq|deepseek-?r1|phi[0-9]+-reasoning|kimi|gpt-oss|thinking/i;

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
