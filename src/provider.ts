import { appendToBlockquote } from '@agentsy/formatting';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Ollama, type ChatResponse, type Message, type ShowResponse, type Tool } from 'ollama';
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
  LanguageModelThinkingPart,
  LanguageModelToolCallPart,
  LanguageModelToolResultPart,
  Progress,
  ProvideLanguageModelChatResponseOptions,
  Uri,
  window,
  workspace,
} from 'vscode';
import { getCloudOllamaClient, getOllamaAuthToken, getOllamaClient, getOllamaHost } from './client';
import { nativeSdkChatOnce, nativeSdkStreamChat, openAiCompatChatOnce, openAiCompatStreamChat } from './chatUtils.js';
import { BASE_SYSTEM_PROMPT, detectsRepetition, resolveContextLimit, renderOllamaPrompt } from './contextUtils.js';
import type { DiagnosticsLogger } from './diagnostics.js';
import { reportError } from './errorHandler.js';
import {
  createXmlStreamFilter,
  dedupeXmlContextBlocksByTag,
  sanitizeNonStreamingModelOutput,
  splitLeadingXmlContextBlocks,
} from './formatting';
import { getModelOptionsForModel, type ModelOptionOverrides, type ModelSettingsStore } from './modelSettings.js';
import { getSetting } from './settings.js';
import { ThinkingParser } from './thinkingParser.js';
import { buildNativeToolsArray, isToolsNotSupportedError } from './toolUtils.js';

const MODEL_LIST_REFRESH_MIN_INTERVAL_MS = 5_000;
const MODEL_LIST_REFRESH_SILENT_GRACE_PERIOD_MS = 30 * 60 * 1000; // 30-minute grace period for silent mode
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

type ChatStreamFn = (
  think: boolean,
  t?: Parameters<OllamaChatModelProvider['client']['chat']>[0]['tools'],
) => Promise<AsyncIterable<ChatResponse>>;

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
    private getModelSettings?: () => ModelSettingsStore,
  ) {}

  /**
   * Provide information about available chat models.
   * The silent parameter is used to indicate whether credential prompts should be suppressed.
   * When silent=true, uses cached models within the grace period to avoid network calls.
   */
  async provideLanguageModelChatInformation(
    options: { silent: boolean },
    _token: CancellationToken,
  ): Promise<LanguageModelChatInformation[]> {
    const now = Date.now();

    // In silent mode, use cached models if available and within grace period
    if (
      options.silent &&
      this.cachedModelList.length > 0 &&
      now - this.lastModelListRefreshMs < MODEL_LIST_REFRESH_SILENT_GRACE_PERIOD_MS
    ) {
      return this.cachedModelList;
    }

    // In non-silent mode, use standard throttle window
    if (
      !options.silent &&
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
        // Output tokens should not mirror picker-context fallback values.
        // Use a conservative default when model metadata is unavailable.
        maxOutputTokens: 4096,
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
   * Extract context_length from a Map or object by searching for the key or key.context_length suffix
   */
  private extractContextLengthFromInfo(modelinfo: Map<string, unknown> | Record<string, unknown>): unknown {
    if (modelinfo instanceof Map) {
      for (const [key, value] of modelinfo.entries()) {
        if (key === 'context_length' || key.endsWith('.context_length')) {
          return value;
        }
      }
    } else {
      for (const [key, value] of Object.entries(modelinfo)) {
        if (key === 'context_length' || key.endsWith('.context_length')) {
          return value;
        }
      }
    }
    return undefined;
  }

  /**
   * Extract context_length from parameters string (num_ctx field)
   */
  private extractContextLengthFromParameters(parameters: string | undefined): number {
    if (!parameters) return 0;
    const match = /^num_ctx\s+(\d+)/m.exec(parameters);
    return match ? Number.parseInt(match[1], 10) : 0;
  }

  /**
   * Get information about a specific model
   */
  private parseModelContextLength(
    modelinfo: Map<string, unknown> | Record<string, unknown> | undefined,
    parameters: string | undefined,
  ): number {
    if (modelinfo) {
      const infoCtx = this.extractContextLengthFromInfo(modelinfo);
      if (typeof infoCtx === 'number' && infoCtx > 0) {
        return infoCtx;
      }
    }

    const parametersCtx = this.extractContextLengthFromParameters(parameters);
    return Math.max(parametersCtx, 0);
  }

  private parseModelMaxOutputTokens(parameters: string | undefined, advertisedContextLength: number): number {
    if (parameters) {
      const predictMatch = /num_predict\s+(-?\d+)/m.exec(parameters);
      if (predictMatch) {
        const val = parseInt(predictMatch[1], 10);
        return val > 0 ? val : advertisedContextLength;
      }
    }
    return 4096;
  }

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
      // Ollama exposes context_length in model_info using family-specific keys
      // (e.g. llama.context_length, qwen2.context_length, gemma.context_length).
      const contextLength = this.parseModelContextLength(modelinfo, parameters);

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
      const maxOutputTokens = this.parseModelMaxOutputTokens(parameters, advertisedContextLength);

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

  private reportThinkingChunk(
    text: string,
    state: { thinkingStarted: boolean; thinkingLineStart: boolean; emittedOutput: boolean },
    progress: Progress<LanguageModelResponsePart>,
    hideThinkingContent: boolean,
  ): void {
    const reportUnknownPart = progress.report as unknown as (part: unknown) => void;
    if (!state.thinkingStarted) {
      // Phase 3: Emit native LanguageModelThinkingPart if available
      try {
        reportUnknownPart(new LanguageModelThinkingPart(hideThinkingContent ? '' : 'Thinking...'));
      } catch {
        // Fallback to markdown if LanguageModelThinkingPart not available
      }
      progress.report(new LanguageModelTextPart('\n\n> 💭 **Thinking**\n>\n'));
      state.thinkingStarted = true;
      state.thinkingLineStart = true;
      state.emittedOutput = true;
    }
    if (!hideThinkingContent) {
      // Phase 3: Emit thinking content via native API
      try {
        reportUnknownPart(new LanguageModelThinkingPart(text));
      } catch {
        // Fallback to markdown if API not available
      }
      const formatted = appendToBlockquote(text, state.thinkingLineStart);
      state.thinkingLineStart = false;
      progress.report(new LanguageModelTextPart(formatted));
      state.emittedOutput = true;
    }
  }

  private reportToolCalls(
    toolCalls: Array<{ function?: { name?: string; arguments?: unknown }; id?: unknown }>,
    progress: Progress<LanguageModelResponsePart>,
  ): void {
    for (const toolCall of toolCalls) {
      const vsCodeId = this.generateToolCallId();
      const upstreamId =
        typeof (toolCall as { id?: unknown }).id === 'string' ? (toolCall as unknown as { id: string }).id : vsCodeId;
      this.mapToolCallId(vsCodeId, upstreamId);
      progress.report(
        new LanguageModelToolCallPart(vsCodeId, toolCall.function?.name || '', toolCall.function?.arguments || {}),
      );
    }
  }

  private async handleCrashError(runtimeModelId: string, perRequestClient: Ollama): Promise<void> {
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
        window.showWarningMessage(
          `Could not open Ollama logs at ${logsPath}. Please check that the Ollama server is installed and logging is enabled.`,
        );
      }
    }
  }

  private async attemptCloudRescue(params: {
    runtimeModelId: string;
    ollamaMessages: Message[];
    tools: Tool[] | undefined;
    initialShouldThink: boolean;
    perRequestClient: Ollama;
    modelOptions: ModelOptionOverrides;
    hideThinkingContent: boolean;
    progress: Progress<LanguageModelResponsePart>;
  }): Promise<boolean> {
    const {
      runtimeModelId,
      ollamaMessages,
      tools,
      initialShouldThink,
      perRequestClient,
      modelOptions,
      hideThinkingContent,
      progress,
    } = params;
    const rescueBaseMessages = ollamaMessages;
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
        const rescued = await nativeSdkChatOnce({
          modelId: runtimeModelId,
          messages: attempt.messages,
          tools: attempt.tools,
          shouldThink: attempt.think,
          effectiveClient: perRequestClient,
          modelOptions,
        });

        const hasContent = rescued.message?.content || rescued.message?.thinking || rescued.message?.tool_calls?.length;
        if (!hasContent) continue;

        this.outputChannel.info(`[client] cloud non-stream rescue (${attempt.label}) succeeded for ${runtimeModelId}`);

        if (rescued.message?.thinking && !hideThinkingContent) {
          const formatted = appendToBlockquote(rescued.message.thinking, true);
          progress.report(new LanguageModelTextPart(`\n\n> 💭 **Thinking**\n>\n${formatted}\n\n`));
        }

        if (rescued.message?.content) {
          progress.report(new LanguageModelTextPart(sanitizeNonStreamingModelOutput(rescued.message.content)));
        }

        if (rescued.message?.tool_calls && Array.isArray(rescued.message.tool_calls)) {
          this.reportToolCalls(rescued.message.tool_calls, progress);
        }

        return true;
      } catch (rescueError) {
        this.outputChannel.warn(
          `[client] cloud non-stream rescue (${attempt.label}) failed for ${runtimeModelId}: ${String(rescueError)}`,
        );
      }
    }
    return false;
  }

  /**
   * Retry after a thinking support error by disabling thinking and attempting again.
   * Returns null if recovery failed, otherwise returns the response.
   */
  private async recoverFromThinkingError(
    streamFn: ChatStreamFn,
    runtimeModelId: string,
    isCloudModel: boolean,
    tools: Parameters<typeof this.client.chat>[0]['tools'] | undefined,
  ): Promise<{ response: AsyncIterable<ChatResponse>; effectiveTools: typeof tools; shouldThink: boolean } | null> {
    this.thinkingModels.delete(runtimeModelId);
    this.nonThinkingModels.add(runtimeModelId);
    this.outputChannel.debug(`[client] retrying without thinking support for ${runtimeModelId}`);

    try {
      const response = await streamFn(false, tools);
      return { response, effectiveTools: tools, shouldThink: false };
    } catch (retryError) {
      // After disabling thinking, try disabling tools for cloud models
      if (isCloudModel && tools && this.isThinkingInternalServerError(retryError)) {
        this.outputChannel.warn(
          `[client] cloud model ${runtimeModelId} failed with tools after think retry; retrying without tools`,
        );
        const response = await streamFn(false, undefined);
        return { response, effectiveTools: undefined, shouldThink: false };
      }
      throw retryError;
    }
  }

  /**
   * Retry by disabling tools for a cloud model
   */
  private async recoverFromCloudToolsError(
    streamFn: ChatStreamFn,
    runtimeModelId: string,
    shouldThink: boolean,
  ): Promise<{ response: AsyncIterable<ChatResponse>; effectiveTools: undefined; shouldThink: boolean }> {
    this.outputChannel.warn(`[client] cloud model ${runtimeModelId} failed with tools; retrying without tools`);
    const response = await streamFn(shouldThink, undefined);
    return { response, effectiveTools: undefined, shouldThink };
  }

  /**
   * Retry by disabling tools for any model
   */
  private async recoverFromToolsError(
    streamFn: ChatStreamFn,
    runtimeModelId: string,
    shouldThink: boolean,
  ): Promise<{ response: AsyncIterable<ChatResponse>; effectiveTools: undefined; shouldThink: boolean }> {
    this.outputChannel.warn(`[client] model ${runtimeModelId} rejected tools; retrying without tools`);
    const response = await streamFn(shouldThink, undefined);
    return { response, effectiveTools: undefined, shouldThink };
  }

  private async initiateChatStream(
    streamFn: ChatStreamFn,
    shouldThink: boolean,
    tools: Parameters<typeof this.client.chat>[0]['tools'] | undefined,
    isCloudModel: boolean,
    runtimeModelId: string,
  ): Promise<{ response: AsyncIterable<ChatResponse>; effectiveTools: typeof tools; shouldThink: boolean }> {
    try {
      this.outputChannel.debug(
        `[client] chat request: model=${runtimeModelId}, tools=${tools?.length ?? 0}, think=${shouldThink}, native=${!isCloudModel}`,
      );
      const response = await streamFn(shouldThink, tools);
      this.outputChannel.info(`[client] chat response stream started for ${runtimeModelId}`);
      return { response, effectiveTools: tools, shouldThink };
    } catch (innerError) {
      this.outputChannel.exception(`[client] chat request failed for model ${runtimeModelId}`, innerError);

      // Attempt recovery from thinking errors
      if (
        shouldThink &&
        (this.isThinkingNotSupportedError(innerError) || this.isThinkingInternalServerError(innerError))
      ) {
        const recovered = await this.recoverFromThinkingError(streamFn, runtimeModelId, isCloudModel, tools);
        if (recovered) return recovered;
      }

      // Attempt recovery from tool errors on cloud models
      if (isCloudModel && tools && this.isThinkingInternalServerError(innerError)) {
        return this.recoverFromCloudToolsError(streamFn, runtimeModelId, shouldThink);
      }

      // Attempt recovery from tools not supported
      if (tools && isToolsNotSupportedError(innerError)) {
        return this.recoverFromToolsError(streamFn, runtimeModelId, shouldThink);
      }

      throw innerError;
    }
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
    const rawMessages = this.toOllamaMessages(messages, supportsVision);
    const effectiveMessages = this.ensurePromptMessage(rawMessages, options);
    this.outputChannel.info(
      `[context] before truncation: ${effectiveMessages.length} messages, ${JSON.stringify(effectiveMessages, null, 2).length} chars, model.maxInputTokens=${model.maxInputTokens}`,
    );
    const modelSettings = this.getModelSettings?.();
    const modelOptions: ModelOptionOverrides = modelSettings
      ? getModelOptionsForModel(modelSettings, runtimeModelId)
      : {};
    const maxInputTokens = resolveContextLimit(
      model.maxInputTokens ?? 0,
      modelOptions.num_ctx,
      getSetting<number>('maxContextTokens', 0),
    );
    const ollamaMessages = await renderOllamaPrompt(
      effectiveMessages,
      maxInputTokens,
      // Provide a conservative sync token counter: 4 chars per token
      (text: string) => Math.ceil(text.length / 4),
    );
    this.outputChannel.info(
      `[context] after truncation: ${ollamaMessages.length} messages, ${JSON.stringify(ollamaMessages, null, 2).length} chars`,
    );

    // Build tools array if supported
    let tools: Parameters<typeof this.client.chat>[0]['tools'] | undefined;
    const supportsNativeToolCalling =
      this.nativeToolCallingByModelId.get(model.id) ?? this.nativeToolCallingByModelId.get(runtimeModelId) ?? false;
    if (options.tools && options.tools.length > 0 && supportsNativeToolCalling) {
      tools = buildNativeToolsArray(options.tools);
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
    const hideThinkingContent = getSetting<boolean>('hideThinkingContent', false);

    try {
      let response: AsyncIterable<ChatResponse>;
      let effectiveTools = tools;

      const resolveCloudTransport = async (): Promise<{ baseUrl: string; authToken?: string } | undefined> => {
        if (!isCloudModel) {
          return undefined;
        }
        try {
          return {
            baseUrl: getOllamaHost(),
            authToken: await getOllamaAuthToken(this.context),
          };
        } catch {
          return undefined;
        }
      };

      // Choose API path: native Ollama SDK for local models, OpenAI-compat for cloud
      const streamFn = isCloudModel
        ? async (think: boolean, t?: typeof tools) => {
            const transport = await resolveCloudTransport();
            if (!transport) {
              return nativeSdkStreamChat({
                modelId: runtimeModelId,
                messages: ollamaMessages as Message[],
                tools: t,
                shouldThink: think,
                effectiveClient: perRequestClient,
                modelOptions,
              });
            }
            return openAiCompatStreamChat({
              modelId: runtimeModelId,
              messages: ollamaMessages as Message[],
              tools: t,
              shouldThink: think,
              effectiveClient: perRequestClient,
              baseUrl: transport.baseUrl,
              authToken: transport.authToken,
              modelOptions,
            });
          }
        : (think: boolean, t?: typeof tools) =>
            nativeSdkStreamChat({
              modelId: runtimeModelId,
              messages: ollamaMessages as Message[],
              tools: t,
              shouldThink: think,
              effectiveClient: perRequestClient,
              modelOptions,
            });

      this.outputChannel.debug(
        `[client] full request payload:\n${JSON.stringify({ model: runtimeModelId, messages: ollamaMessages, tools, think: shouldThink }, null, 2)}`,
      );
      ({ response, effectiveTools, shouldThink } = await this.initiateChatStream(
        streamFn as ChatStreamFn,
        shouldThink,
        tools,
        isCloudModel,
        runtimeModelId,
      ));

      const streamState = {
        thinkingStarted: false,
        thinkingLineStart: true,
        contentStarted: false,
        emittedOutput: false,
        responseBuffer: '',
      };
      const repSensitivity = getSetting<'off' | 'conservative' | 'moderate'>('repetitionDetection', 'conservative');
      const xmlFilter = createXmlStreamFilter();
      // Parse <think> tags on both cloud and local paths.
      // For local models Ollama normally pre-splits thinking into message.thinking, but
      // some model/version combinations still emit raw <think> tags in message.content.
      // Applying the parser unconditionally is safe: if content is already clean the
      // parser transitions through lookingForOpening → thinkingDone and passes it unchanged.
      const thinkingParser = shouldThink ? ThinkingParser.forModel(runtimeModelId) : null;

      try {
        for await (const chunk of response) {
          if (token.isCancellationRequested) {
            break;
          }

          this.outputChannel.info(`[client] raw chunk: ${JSON.stringify(chunk)}`);

          // Handle thinking tokens (reasoning phase)
          if (chunk.message?.thinking) {
            this.reportThinkingChunk(chunk.message.thinking, streamState, progress, hideThinkingContent);
          }

          // Stream text chunks — run through thinking tag parser on both cloud and local paths
          if (chunk.message?.content) {
            let thinkingChunk = '';
            let contentChunk = chunk.message.content;

            if (thinkingParser) {
              [thinkingChunk, contentChunk] = thinkingParser.addContent(chunk.message.content);
            }

            if (thinkingChunk) {
              this.reportThinkingChunk(thinkingChunk, streamState, progress, hideThinkingContent);
            }

            if (contentChunk) {
              if (streamState.thinkingStarted && !streamState.contentStarted) {
                progress.report(new LanguageModelTextPart('\n\n'));
                streamState.contentStarted = true;
                streamState.emittedOutput = true;
              }
              this.outputChannel.debug(`[client] streaming chunk: ${contentChunk.substring(0, 50)}`);
              const cleanContent = xmlFilter.write(contentChunk);
              if (cleanContent) {
                progress.report(new LanguageModelTextPart(cleanContent));
                streamState.emittedOutput = true;
                streamState.responseBuffer = (streamState.responseBuffer + cleanContent).slice(-600);
                if (detectsRepetition(streamState.responseBuffer, repSensitivity)) {
                  this.outputChannel.warn(`[client] repetition detected for ${runtimeModelId}; stopping stream`);
                  progress.report(new LanguageModelTextPart('\n\n*[Stopped: repetition detected]*'));
                  break;
                }
              }
            }
          }

          // Handle tool calls
          if (chunk.message?.tool_calls && Array.isArray(chunk.message.tool_calls)) {
            this.reportToolCalls(chunk.message.tool_calls, progress);
            streamState.emittedOutput = true;
          }

          // Some Ollama responses set done=true before the underlying stream closes.
          // Exit promptly so VS Code doesn't stay in a perpetual "waiting" state.
          if (chunk.done === true) {
            break;
          }
        }
      } catch (streamError) {
        const message = streamError instanceof Error ? streamError.message : String(streamError);
        this.outputChannel.warn(`[client] stream iteration failed for ${runtimeModelId}: ${message}`);
        throw new Error(`language model stream interrupted: ${message}`);
      }

      // Finalize XML filter to flush any remaining buffer
      const finalContent = xmlFilter.end();
      if (finalContent) {
        progress.report(new LanguageModelTextPart(finalContent));
        streamState.emittedOutput = true;
      }

      // Some model/server combinations can return a successful stream that emits
      // no visible content or tool calls, which causes VS Code to show
      // "Sorry, no response was returned." Recover by retrying once without
      // streaming and emit any returned content.
      if (!streamState.emittedOutput && !token.isCancellationRequested) {
        this.outputChannel.warn(`[client] stream returned no output for ${runtimeModelId}; retrying with stream=false`);

        const fallbackFn = isCloudModel
          ? async (think: boolean) => {
              const transport = await resolveCloudTransport();
              if (!transport) {
                return nativeSdkChatOnce({
                  modelId: runtimeModelId,
                  messages: ollamaMessages as Message[],
                  tools: effectiveTools,
                  shouldThink: think,
                  effectiveClient: perRequestClient,
                  modelOptions,
                });
              }
              return openAiCompatChatOnce({
                modelId: runtimeModelId,
                messages: ollamaMessages as Message[],
                tools: effectiveTools,
                shouldThink: think,
                effectiveClient: perRequestClient,
                baseUrl: transport.baseUrl,
                authToken: transport.authToken,
                modelOptions,
              });
            }
          : (think: boolean) =>
              nativeSdkChatOnce({
                modelId: runtimeModelId,
                messages: ollamaMessages as Message[],
                tools: effectiveTools,
                shouldThink: think,
                effectiveClient: perRequestClient,
                modelOptions,
              });

        const fallback = await fallbackFn(shouldThink);
        this.outputChannel.info(`[client] non-stream fallback response: ${JSON.stringify(fallback, null, 2)}`);

        if (fallback.message?.thinking && !hideThinkingContent) {
          const formatted = appendToBlockquote(fallback.message.thinking, true);
          progress.report(new LanguageModelTextPart(`\n\n> 💭 **Thinking**\n>\n${formatted}\n\n`));
          streamState.emittedOutput = true;
        }

        if (fallback.message?.content) {
          // Non-stream fallback is complete text; safe to format XML-like blocks.
          progress.report(new LanguageModelTextPart(sanitizeNonStreamingModelOutput(fallback.message.content)));
          streamState.emittedOutput = true;
        }

        if (!streamState.emittedOutput) {
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

        const rescued = await this.attemptCloudRescue({
          runtimeModelId,
          ollamaMessages,
          tools,
          initialShouldThink,
          perRequestClient,
          modelOptions,
          hideThinkingContent,
          progress,
        });
        if (rescued) return;
      }

      const isCrashError = error instanceof Error && error.message.includes('model runner has unexpectedly stopped');
      if (isCrashError) {
        // Best-effort unload so Ollama housekeeps the dead runner — ignore any failure
        await this.handleCrashError(runtimeModelId, perRequestClient);
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
   * `LanguageModelDataPart` is a generic binary carrier in the VS Code API, so
   * only `image/*` MIME parts are forwarded via Ollama's `images` field. Text
   * and JSON data parts are decoded back into inline text content. Unsupported
   * binary parts are stripped and logged.
   */
  private handleDataPart(
    part: LanguageModelDataPart,
    supportsVision: boolean,
    textContentRef: { content: string },
    imagesRef: { images: string[] },
    strippedRef: { images: number; binary: number },
  ): void {
    if (this.isImageMimeType(part.mimeType)) {
      if (supportsVision) {
        imagesRef.images.push(Buffer.from(part.data).toString('base64'));
      } else {
        strippedRef.images++;
      }
      return;
    }

    const extracted = this.extractTextFromDataPart(part);
    if (extracted !== undefined) {
      textContentRef.content += extracted;
    } else {
      strippedRef.binary++;
    }
  }

  private handleToolCallPart(part: LanguageModelToolCallPart, ollamaMsg: Record<string, unknown>): void {
    const toolCalls = ollamaMsg.tool_calls ? (ollamaMsg.tool_calls as Record<string, unknown>[]) : [];
    toolCalls.push({
      id: this.getOllamaToolCallId(part.callId),
      function: { name: part.name, arguments: part.input },
    });
    ollamaMsg.tool_calls = toolCalls;
  }

  private handleToolResultPart(part: LanguageModelToolResultPart, ollamaMessages: Message[]): void {
    const toolContent = part.content
      .filter((contentPart): contentPart is LanguageModelTextPart => contentPart instanceof LanguageModelTextPart)
      .map(contentPart => contentPart.value)
      .join('');
    ollamaMessages.push({
      role: 'tool',
      content: toolContent,
      tool_call_id: this.getOllamaToolCallId(part.callId),
    } as never);
  }

  private processMsgContentPart(
    part: unknown,
    supportsVision: boolean,
    ollamaMsg: Record<string, unknown>,
    ollamaMessages: Message[],
    textContentRef: { content: string },
    imagesRef: { images: string[] },
    strippedRef: { images: number; binary: number },
  ): void {
    if (part instanceof LanguageModelTextPart) {
      textContentRef.content += part.value;
    } else if (part instanceof LanguageModelDataPart) {
      this.handleDataPart(part, supportsVision, textContentRef, imagesRef, strippedRef);
    } else if (part instanceof LanguageModelToolCallPart) {
      this.handleToolCallPart(part, ollamaMsg);
    } else if (part instanceof LanguageModelToolResultPart) {
      this.handleToolResultPart(part, ollamaMessages);
    } else {
      const extracted = this.extractTextFromUnknownInputPart(part);
      if (extracted) {
        textContentRef.content += extracted;
      }
    }
  }

  private processMsgContent(
    msg: LanguageModelChatRequestMessage,
    supportsVision: boolean,
    ollamaMessages: Message[],
    systemContextParts: string[],
  ): { strippedImages: number; strippedBinary: number } {
    const role = msg.role === LanguageModelChatMessageRole.User ? 'user' : 'assistant';
    const ollamaMsg: Record<string, unknown> = { role };
    const textContentRef = { content: '' };
    const imagesRef = { images: [] };
    const strippedRef = { images: 0, binary: 0 };

    for (const part of msg.content) {
      this.processMsgContentPart(
        part,
        supportsVision,
        ollamaMsg,
        ollamaMessages,
        textContentRef,
        imagesRef,
        strippedRef,
      );
    }

    // Handle context extraction for user messages
    if (role === 'user') {
      const split = splitLeadingXmlContextBlocks(textContentRef.content);
      if (split.contextBlocks.length > 0) {
        systemContextParts.push(...split.contextBlocks);
      }
      textContentRef.content = split.content;
    }

    // Add content and images to message
    if (textContentRef.content || imagesRef.images.length > 0) {
      ollamaMsg.content = textContentRef.content;
    }
    if (imagesRef.images.length > 0) {
      ollamaMsg.images = imagesRef.images;
    }
    if (ollamaMsg.content || ollamaMsg.tool_calls) {
      ollamaMessages.push(ollamaMsg as never);
    }

    return { strippedImages: strippedRef.images, strippedBinary: strippedRef.binary };
  }

  private toOllamaMessages(messages: readonly LanguageModelChatRequestMessage[], supportsVision = true): Message[] {
    const ollamaMessages: Message[] = [];
    const systemContextParts: string[] = [];
    let strippedImageCount = 0;
    let strippedBinaryDataCount = 0;

    for (const msg of messages) {
      const { strippedImages, strippedBinary } = this.processMsgContent(
        msg,
        supportsVision,
        ollamaMessages,
        systemContextParts,
      );
      strippedImageCount += strippedImages;
      strippedBinaryDataCount += strippedBinary;
    }

    const dedupedContextParts = dedupeXmlContextBlocksByTag(systemContextParts);

    if (dedupedContextParts.length > 0) {
      ollamaMessages.unshift({
        role: 'system',
        content: BASE_SYSTEM_PROMPT + '\n\n' + dedupedContextParts.join('\n\n'),
      } as never);
    } else {
      ollamaMessages.unshift({
        role: 'system',
        content: BASE_SYSTEM_PROMPT,
      } as never);
    }

    if (strippedImageCount > 0) {
      this.outputChannel.debug(
        `[client] stripped ${strippedImageCount} image(s) from messages (model does not support vision)`,
      );
    }

    if (strippedBinaryDataCount > 0) {
      this.outputChannel.debug(
        `[client] stripped ${strippedBinaryDataCount} non-image binary data part(s) from messages`,
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
      return undefined;
    }

    try {
      return new TextDecoder('utf-8').decode(part.data);
    } catch {
      return undefined;
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
      if (typeof maybePart[key] === 'string') {
        return maybePart[key];
      }
    }

    for (const key of directStringKeys) {
      const nested = maybePart[key];
      if (nested && typeof nested === 'object') {
        const nestedVal = (nested as Record<string, unknown>).value;
        if (typeof nestedVal === 'string') {
          return nestedVal;
        }
      }
    }

    const toString = (part as { toString?: () => string }).toString;
    if (typeof toString !== 'function') {
      return '';
    }
    const converted = toString.call(part);
    return converted && converted !== '[object Object]' ? converted : '';
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
      mimeType: part instanceof LanguageModelDataPart ? part.mimeType : undefined,
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
    if (typeof value !== 'object' || seen.has(value)) {
      return '';
    }
    seen.add(value);

    if (Array.isArray(value)) {
      for (const item of value) {
        const found = this.deepFindPromptString(item, depth + 1, seen);
        if (found) return found;
      }
      return '';
    }

    return this.deepFindInObject(value as Record<string, unknown>, depth, seen);
  }

  private deepFindInObject(record: Record<string, unknown>, depth: number, seen: Set<unknown>): string {
    const priorityKeys = ['prompt', 'userPrompt', 'query', 'input', 'text', 'message'];
    for (const key of priorityKeys) {
      if (key in record) {
        const found = this.deepFindPromptString(record[key], depth + 1, seen);
        if (found) return found;
      }
    }

    const ignoredKeys = new Set(['toolMode', 'tools']);
    for (const [key, child] of Object.entries(record)) {
      if (!ignoredKeys.has(key)) {
        const found = this.deepFindPromptString(child, depth + 1, seen);
        if (found) return found;
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
const THINKING_MODEL_PATTERN = /qwen3|qwq|deepseek-?r1|phi\d+-reasoning|kimi|thinking/i;

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
