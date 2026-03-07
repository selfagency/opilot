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
import { getCloudOllamaClient, getContextLengthOverride, getOllamaClient } from './client';
import type { DiagnosticsLogger } from './diagnostics.js';

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
      this.outputChannel.exception('[Ollama] Failed to fetch models', error);
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
      }
    }
  }

  private clearModelCache(): void {
    this.modelInfoCache.clear();
    this.models.clear();
    this.nativeToolCallingByModelId.clear();
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
    const contextLength = getContextLengthOverride();
    const nativeToolCalling = false;
    this.nativeToolCallingByModelId.set(modelId, nativeToolCalling);
    this.nativeToolCallingByModelId.set(providerModelId, nativeToolCalling);
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
   * VS Code's chat model pickers filter out models with `toolCalling: false`,
   * even when `isUserSelectable: true` and category are correctly set.
   *
   * Workaround: Advertise `toolCalling: true` for ALL models to pass picker
   * filters. At runtime, non-tool models will ignore tool parameters (Ollama
   * SDK behavior), ensuring correct operation while maintaining picker visibility.
   *
   * Native capability is still tracked separately via `nativeToolCallingByModelId`
   * for internal reference.
   */
  private getAdvertisedToolCalling(_nativeToolCalling: boolean): boolean {
    // Always advertise true to pass VS Code's picker filtering
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

      const nativeToolCalling = this.isToolModel(response);
      this.nativeToolCallingByModelId.set(modelId, nativeToolCalling);
      this.nativeToolCallingByModelId.set(providerModelId, nativeToolCalling);
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
            imageInput: this.isVisionModel(response),
            toolCalling: this.getAdvertisedToolCalling(nativeToolCalling),
          },
        },
        nativeToolCalling,
      );
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
    const runtimeModelId = this.toRuntimeModelId(model.id);

    // Convert VS Code messages to Ollama format
    const ollamaMessages = this.toOllamaMessages(messages);

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
          parameters: tool.inputSchema as Record<string, unknown>,
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

    try {
      let response: AsyncIterable<ChatResponse>;

      try {
        response = await perRequestClient.chat({
          model: runtimeModelId,
          messages: ollamaMessages,
          stream: true,
          tools,
          ...(shouldThink ? { think: true } : {}),
        });
      } catch (innerError) {
        if (shouldThink && this.isThinkingNotSupportedError(innerError)) {
          this.thinkingModels.delete(runtimeModelId);
          this.nonThinkingModels.add(runtimeModelId);
          response = await perRequestClient.chat({
            model: runtimeModelId,
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

      const isCrashError = error instanceof Error && error.message.includes('model runner has unexpectedly stopped');
      if (isCrashError) {
        // Best-effort unload so Ollama housekeeps the dead runner — ignore any failure
        perRequestClient.generate({ model: runtimeModelId, prompt: '', keep_alive: 0, stream: false }).catch(() => {});
        void window.showErrorMessage(
          'The Ollama model runner crashed. Please check the Ollama server logs and restart if needed.',
          'Open Logs',
        );
      }

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
    const XML_CONTEXT_TAG_RE = /<(environment_info|workspace_info|selection|file_context)[^>]*>[\s\S]*?<\/\1>/gi;
    const systemContextParts: string[] = [];

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
        }
      }

      // Ollama requires content to be a string (images are separate field)
      if (role === 'user') {
        // Strip only *leading* VS Code-injected XML context blocks; accumulate for system message.
        // This avoids treating arbitrary user-provided tags as privileged system context.
        let remainingText = textContent;
        let hadLeadingContext = false;

        if (remainingText.trimStart().startsWith('<')) {
          remainingText = remainingText.trimStart();
          // Iteratively consume XML_CONTEXT_TAG_RE matches only when they appear at the very start
          // of the remaining text. As soon as a match is not at index 0, we stop extracting.
          XML_CONTEXT_TAG_RE.lastIndex = 0;
          // eslint-disable-next-line no-constant-condition
          while (true) {
            const match = XML_CONTEXT_TAG_RE.exec(remainingText);
            if (!match || match.index !== 0) {
              break;
            }
            const matchedText = match[0];
            systemContextParts.push(matchedText.trim());
            remainingText = remainingText.slice(matchedText.length).trimStart();
            hadLeadingContext = true;
            // Reset lastIndex because we've sliced the string.
            XML_CONTEXT_TAG_RE.lastIndex = 0;
          }
        }

        textContent = hadLeadingContext ? remainingText : textContent.trim();
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

    // Deduplicate context blocks by tag type, keeping only the most recent occurrence
    const latestByTag = new Map<string, string>();
    for (let i = systemContextParts.length - 1; i >= 0; i--) {
      const part = systemContextParts[i];
      XML_CONTEXT_TAG_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      // Use a loop in case a single part contains multiple context blocks
      // (we still only keep the latest block per tag type).
      while ((match = XML_CONTEXT_TAG_RE.exec(part)) !== null) {
        const tagName = match[1];
        if (!latestByTag.has(tagName)) {
          latestByTag.set(tagName, match[0]);
        }
      }
    }

    const tagOrder: Array<'environment_info' | 'workspace_info' | 'selection' | 'file_context'> = [
      'environment_info',
      'workspace_info',
      'selection',
      'file_context',
    ];

    const dedupedContextParts: string[] = [];
    for (const tag of tagOrder) {
      const block = latestByTag.get(tag);
      if (block) {
        dedupedContextParts.push(block);
      }
    }

    if (dedupedContextParts.length > 0) {
      ollamaMessages.unshift({
        role: 'system',
        content: dedupedContextParts.join('\n\n'),
      } as never);
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
