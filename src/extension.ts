import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promises as fsPromises } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ChatResponse, Message, Ollama, Options, Tool } from 'ollama';
import * as vscode from 'vscode';
import { getCloudOllamaClient, getOllamaAuthToken, getOllamaClient, getOllamaHost, testConnection } from './client.js';
import { OllamaInlineCompletionProvider } from './completions.js';
import { truncateMessages } from './contextUtils.js';
import { createDiagnosticsLogger, getConfiguredLogLevel, type DiagnosticsLogger } from './diagnostics.js';
import { reportError } from './errorHandler.js';
import {
  createXmlStreamFilter,
  dedupeXmlContextBlocksByTag,
  sanitizeNonStreamingModelOutput,
  splitLeadingXmlContextBlocks,
} from './formatting';
import { registerModelfileManager } from './modelfiles.js';
import {
  loadModelSettings,
  saveModelSettings,
  getModelOptionsForModel,
  type ModelOptionOverrides,
  type ModelSettingsStore,
} from './modelSettings.js';
import { chatCompletionsOnce, initiateChatCompletionsStream } from './openaiCompat.js';
import { ollamaMessagesToOpenAICompat, ollamaToolsToOpenAICompat } from './openaiCompatMapping.js';
import { isThinkingModelId, OllamaChatModelProvider } from './provider.js';
import { createModelSettingsViewProvider, MODEL_SETTINGS_VIEW_ID } from './settingsWebview.js';
import { registerSidebar, type SidebarProfilingSnapshot } from './sidebar.js';
import { registerStatusBarHeartbeat } from './statusBar.js';
import { ThinkingParser } from './thinkingParser.js';
import {
  buildXmlToolSystemPrompt,
  extractXmlToolCalls,
  isToolsNotSupportedError,
  normalizeToolParameters,
} from './toolUtils.js';

const LANGUAGE_MODEL_VENDOR = 'selfagency-opilot';
const PROVIDER_MODEL_ID_PREFIX = 'ollama:';
/** VS Code Autopilot signals task completion by having the model call this tool. */
const TASK_COMPLETE_TOOL_NAME = 'task_complete';
let builtInOllamaConflictPromptInProgress = false;

export function toRuntimeModelId(modelId: string): string {
  return modelId.startsWith(PROVIDER_MODEL_ID_PREFIX) ? modelId.slice(PROVIDER_MODEL_ID_PREFIX.length) : modelId;
}

export function mapOpenAiToolCallsToOllamaLike(toolCalls: unknown):
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

async function openAiCompatStreamChat(params: {
  modelId: string;
  messages: Message[];
  tools?: Tool[];
  shouldThink: boolean;
  effectiveClient: Ollama;
  extensionContext?: vscode.ExtensionContext;
  signal?: AbortSignal;
  modelOptions?: ModelOptionOverrides;
}): Promise<AsyncIterable<ChatResponse>> {
  const { temperature, top_p, num_predict, top_k, num_ctx, think_budget } = params.modelOptions ?? {};
  try {
    const baseUrl = getOllamaHost();
    const authToken = params.extensionContext ? await getOllamaAuthToken(params.extensionContext) : undefined;

    // Use initiateChatCompletionsStream (eager fetch) so that any connection
    // or HTTP error is thrown here, allowing the catch below to fall back to
    // effectiveClient.chat() rather than surfacing during generator iteration.
    const stream = await initiateChatCompletionsStream({
      baseUrl,
      authToken,
      signal: params.signal,
      request: {
        model: params.modelId,
        messages: ollamaMessagesToOpenAICompat(params.messages),
        tools: ollamaToolsToOpenAICompat(params.tools),
        ...(params.shouldThink ? { think: true } : {}),
        ...(temperature !== undefined ? { temperature } : {}),
        ...(top_p !== undefined ? { top_p } : {}),
        ...(num_predict !== undefined ? { max_tokens: num_predict } : {}),
        ...(top_k !== undefined ? { top_k } : {}),
        ...(num_ctx !== undefined ? { num_ctx } : {}),
        ...(think_budget !== undefined ? { think_budget } : {}),
      },
    });

    return (async function* (): AsyncGenerator<ChatResponse> {
      for await (const chunk of stream) {
        const choice = chunk.choices?.[0];
        const delta = choice?.delta;
        const content = typeof delta?.content === 'string' ? delta.content : '';
        const thinking = typeof delta?.reasoning === 'string' ? delta.reasoning : undefined;
        const mappedToolCalls = mapOpenAiToolCallsToOllamaLike(delta?.tool_calls);

        yield {
          message: {
            role: 'assistant',
            content,
            ...(thinking ? { thinking } : {}),
            ...(mappedToolCalls ? { tool_calls: mappedToolCalls } : {}),
          },
          done: choice?.finish_reason != null,
        } as ChatResponse;
      }
    })();
  } catch {
    const sdkOptions = params.modelOptions ? buildSdkOptions(params.modelOptions) : undefined;
    return params.effectiveClient.chat({
      model: params.modelId,
      messages: params.messages,
      stream: true,
      ...(params.tools ? { tools: params.tools } : {}),
      ...(params.shouldThink ? { think: true } : {}),
      ...(sdkOptions ? { options: sdkOptions } : {}),
    });
  }
}

async function openAiCompatChatOnce(params: {
  modelId: string;
  messages: Message[];
  tools?: Tool[];
  shouldThink: boolean;
  effectiveClient: Ollama;
  extensionContext?: vscode.ExtensionContext;
  signal?: AbortSignal;
  modelOptions?: ModelOptionOverrides;
}): Promise<ChatResponse> {
  const { temperature, top_p, num_predict, top_k, num_ctx, think_budget } = params.modelOptions ?? {};
  try {
    const baseUrl = getOllamaHost();
    const authToken = params.extensionContext ? await getOllamaAuthToken(params.extensionContext) : undefined;

    const response = await chatCompletionsOnce({
      baseUrl,
      authToken,
      signal: params.signal,
      request: {
        model: params.modelId,
        messages: ollamaMessagesToOpenAICompat(params.messages),
        tools: ollamaToolsToOpenAICompat(params.tools),
        ...(params.shouldThink ? { think: true } : {}),
        ...(temperature !== undefined ? { temperature } : {}),
        ...(top_p !== undefined ? { top_p } : {}),
        ...(num_predict !== undefined ? { max_tokens: num_predict } : {}),
        ...(top_k !== undefined ? { top_k } : {}),
        ...(num_ctx !== undefined ? { num_ctx } : {}),
        ...(think_budget !== undefined ? { think_budget } : {}),
      },
    });

    const choice = response.choices?.[0];
    const content = typeof choice?.message?.content === 'string' ? choice.message.content : '';
    const thinking = typeof choice?.message?.reasoning === 'string' ? choice.message.reasoning : undefined;
    const mappedToolCalls = mapOpenAiToolCallsToOllamaLike(choice?.message?.tool_calls);

    return {
      message: {
        role: 'assistant',
        content,
        ...(thinking ? { thinking } : {}),
        ...(mappedToolCalls ? { tool_calls: mappedToolCalls } : {}),
      },
      done: true,
    } as ChatResponse;
  } catch {
    const sdkOptions = params.modelOptions ? buildSdkOptions(params.modelOptions) : undefined;
    return (await params.effectiveClient.chat({
      model: params.modelId,
      messages: params.messages,
      stream: false,
      ...(params.tools ? { tools: params.tools } : {}),
      ...(params.shouldThink ? { think: true } : {}),
      ...(sdkOptions ? { options: sdkOptions } : {}),
    })) as ChatResponse;
  }
}

async function nativeSdkStreamChat(params: {
  modelId: string;
  messages: Message[];
  tools?: Tool[];
  shouldThink: boolean;
  effectiveClient: Ollama;
  modelOptions?: ModelOptionOverrides;
}): Promise<AsyncIterable<ChatResponse>> {
  const sdkOptions = params.modelOptions ? buildSdkOptions(params.modelOptions) : undefined;
  return params.effectiveClient.chat({
    model: params.modelId,
    messages: params.messages,
    stream: true,
    ...(params.tools ? { tools: params.tools } : {}),
    ...(params.shouldThink ? { think: true } : {}),
    ...(sdkOptions ? { options: sdkOptions } : {}),
  });
}

async function nativeSdkChatOnce(params: {
  modelId: string;
  messages: Message[];
  tools?: Tool[];
  shouldThink: boolean;
  effectiveClient: Ollama;
  modelOptions?: ModelOptionOverrides;
}): Promise<ChatResponse> {
  const sdkOptions = params.modelOptions ? buildSdkOptions(params.modelOptions) : undefined;
  return (await params.effectiveClient.chat({
    model: params.modelId,
    messages: params.messages,
    stream: false,
    ...(params.tools ? { tools: params.tools } : {}),
    ...(params.shouldThink ? { think: true } : {}),
    ...(sdkOptions ? { options: sdkOptions } : {}),
  })) as ChatResponse;
}

// normalizeToolParameters/isToolsNotSupportedError moved to src/toolUtils.ts

/**
 * Build an Ollama SDK options object from per-model overrides.
 * Returns undefined when no overrides are set so callers can omit the field entirely.
 */
function buildSdkOptions(overrides: ModelOptionOverrides): Partial<Options> | undefined {
  const { temperature, top_p, top_k, num_ctx, num_predict, think_budget } = overrides;
  const opts: Record<string, number> = {};
  if (temperature !== undefined) opts['temperature'] = temperature;
  if (top_p !== undefined) opts['top_p'] = top_p;
  if (top_k !== undefined) opts['top_k'] = top_k;
  if (num_ctx !== undefined) opts['num_ctx'] = num_ctx;
  if (num_predict !== undefined) opts['num_predict'] = num_predict;
  // think_budget is not yet in the Ollama SDK's Options type but is forwarded as-is
  if (think_budget !== undefined) opts['think_budget'] = think_budget;
  return Object.keys(opts).length > 0 ? (opts as Partial<Options>) : undefined;
}

export function isSelectedAction(selection: unknown, actionLabel: string): boolean {
  if (typeof selection === 'string') {
    return selection === actionLabel;
  }

  if (selection && typeof selection === 'object' && 'title' in selection) {
    return (selection as { title?: unknown }).title === actionLabel;
  }

  return false;
}

async function removeBuiltInOllamaFromChatLanguageModels(
  context: Pick<vscode.ExtensionContext, 'globalStorageUri'>,
): Promise<boolean> {
  const candidatePaths = new Set<string>();

  // globalStorageUri: .../profiles/<profile-id>/globalStorage/<extension-id>
  // or .../User/globalStorage/<extension-id>
  const profileDir = dirname(dirname(context.globalStorageUri.fsPath));
  candidatePaths.add(join(profileDir, 'chatLanguageModels.json'));

  // Standard VS Code user folders per platform where profile data lives.
  const userDirs: string[] = [];
  if (process.platform === 'darwin') {
    userDirs.push(join(homedir(), 'Library', 'Application Support', 'Code', 'User'));
  } else if (process.platform === 'win32') {
    const appData = process.env['APPDATA'];
    if (appData) {
      userDirs.push(join(appData, 'Code', 'User'));
    }
  } else {
    // Linux (and other POSIX)
    const xdgConfig = process.env['XDG_CONFIG_HOME'] || join(homedir(), '.config');
    userDirs.push(join(xdgConfig, 'Code', 'User'));
  }
  for (const userDir of userDirs) {
    candidatePaths.add(join(userDir, 'chatLanguageModels.json'));
  }

  // Profile-scoped files: User/profiles/<id>/chatLanguageModels.json
  for (const userDir of userDirs) {
    try {
      const profilesDir = join(userDir, 'profiles');
      const entries = await fsPromises.readdir(profilesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          candidatePaths.add(join(profilesDir, entry.name, 'chatLanguageModels.json'));
        }
      }
    } catch {
      // profiles directory may not exist
    }
  }

  let changed = false;
  for (const modelsPath of candidatePaths) {
    try {
      const raw = await fsPromises.readFile(modelsPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        continue;
      }

      const filtered = parsed.filter(
        item => !(item && typeof item === 'object' && (item as Record<string, unknown>).vendor === 'ollama'),
      );

      if (filtered.length === parsed.length) {
        continue;
      }

      await fsPromises.writeFile(modelsPath, `${JSON.stringify(filtered, null, 2)}\n`, 'utf8');
      changed = true;
    } catch {
      // file missing/unreadable/unwritable for this candidate, continue trying others
    }
  }

  return changed;
}

/**
 * Handle configuration changes for log level and auto-start log streaming
 */
export function handleConfigurationChange(
  event: vscode.ConfigurationChangeEvent,
  diagnostics: DiagnosticsLogger,
  onLogLevelChange?: () => void,
  onAutoStartChange?: (enabled: boolean) => void,
): void {
  if (event.affectsConfiguration('ollama.diagnostics.logLevel')) {
    diagnostics.info(`[client] Diagnostics log level changed to: ${getConfiguredLogLevel()}`);
    onLogLevelChange?.();
  }

  if (!event.affectsConfiguration('ollama.streamLogs')) {
    return;
  }

  const enabled = vscode.workspace.getConfiguration('ollama').get<boolean>('streamLogs') ?? true;
  diagnostics.info(`[client] Auto-start log streaming setting changed: ${enabled ? 'enabled' : 'disabled'}`);
  onAutoStartChange?.(enabled);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function logPerformanceSnapshot(
  diagnostics: DiagnosticsLogger,
  sidebarSnapshot?: SidebarProfilingSnapshot,
  label = 'manual',
): void {
  const memory = process.memoryUsage();

  const payload = {
    kind: 'performance_snapshot',
    label,
    timestamp: new Date().toISOString(),
    memory: {
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      externalBytes: memory.external,
      arrayBuffersBytes: memory.arrayBuffers,
      rss: formatBytes(memory.rss),
      heapUsed: formatBytes(memory.heapUsed),
      heapTotal: formatBytes(memory.heapTotal),
      external: formatBytes(memory.external),
      arrayBuffers: formatBytes(memory.arrayBuffers),
    },
    sidebar: sidebarSnapshot ?? null,
  };

  diagnostics.info(`[client] ${JSON.stringify(payload)}`);
}
export async function handleConnectionTestFailure(
  host: string,
  windowApi?: Pick<typeof vscode.window, 'showErrorMessage'>,
  commandsApi?: Pick<typeof vscode.commands, 'executeCommand'>,
): Promise<void> {
  const window = windowApi || vscode.window;
  const commands = commandsApi || vscode.commands;

  const selection = await window.showErrorMessage(
    `Cannot connect to Ollama server at ${host}. Please check your ollama.host setting and authentication token.`,
    'Open Settings',
    'Open Logs',
  );
  if (selection === 'Open Settings') {
    await commands.executeCommand('workbench.action.openSettings', 'ollama');
    return;
  }

  if (selection === 'Open Logs') {
    // Attempt to open the Ollama server log file for the current platform
    const logsPath = getOllamaServerLogPath();
    if (logsPath) {
      try {
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(logsPath));
        await vscode.window.showTextDocument(document, { preview: false });
        return;
      } catch {
        void vscode.window.showWarningMessage(`Could not open Ollama logs at ${logsPath}.`);
        return;
      }
    }
    void vscode.window.showWarningMessage(
      'Ollama logs are not available on this platform via file; try journalctl or check Ollama documentation.',
    );
  }
}

export function getOllamaServerLogPath(): string | null {
  const platform = process.platform;
  if (platform === 'darwin') {
    return join(homedir(), '.ollama', 'logs', 'server.log');
  }
  if (platform === 'win32') {
    const localApp = process.env.LOCALAPPDATA;
    if (localApp) return join(localApp, 'Ollama', 'server.log');
    return null;
  }
  // On Linux we prefer journalctl; no single log file available
  return null;
}

/**
 * Set up chat participant with icon and register it
 */
export function setupChatParticipant(
  context: vscode.ExtensionContext,
  participantHandler: vscode.ChatRequestHandler,
  chatApi?: Pick<typeof vscode.chat, 'createChatParticipant'>,
): vscode.Disposable {
  const chat = chatApi || vscode.chat;

  const participant = chat.createChatParticipant('opilot.ollama', participantHandler);
  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'logo.png');
  return participant;
}

/**
 * Detect and offer to disable Copilot's conflicting built-in Ollama provider.
 * Detects via LM models registered under vendor 'ollama'.
 */
export async function handleBuiltInOllamaConflict(
  windowApi?: Pick<typeof vscode.window, 'showWarningMessage' | 'showInformationMessage' | 'showErrorMessage'>,
  workspaceApi?: Pick<typeof vscode.workspace, 'getConfiguration'>,
  lmApi?: Pick<typeof vscode.lm, 'selectChatModels'>,
  commandsApi?: Pick<typeof vscode.commands, 'executeCommand'>,
  context?: Pick<vscode.ExtensionContext, 'globalStorageUri'>,
): Promise<void> {
  if (builtInOllamaConflictPromptInProgress) {
    return;
  }

  const win = windowApi ?? vscode.window;
  const ws = workspaceApi ?? vscode.workspace;
  const lm = lmApi ?? vscode.lm;
  const commands = commandsApi ?? vscode.commands;

  const conflictModels = await lm.selectChatModels({ vendor: 'ollama' });
  if (!conflictModels.length) return;

  builtInOllamaConflictPromptInProgress = true;
  try {
    const selection = await win.showWarningMessage(
      "Copilot's built-in Ollama provider is active and will show duplicate models alongside this extension. Disable it?",
      'Disable Built-in Ollama Provider',
    );

    if (!isSelectedAction(selection, 'Disable Built-in Ollama Provider')) return;

    // Use empty string to disable the built-in provider explicitly.
    // Using undefined can fall back to a non-empty default and keep it enabled.
    let disabled = false;
    try {
      await (ws.getConfiguration('github.copilot.chat') as vscode.WorkspaceConfiguration).update(
        'ollama.url',
        '',
        vscode.ConfigurationTarget.Global,
      );
      disabled = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // Some debug hosts don't register github.copilot.chat.ollama.url as a writable setting.
      // Fall back to profile-scoped chatLanguageModels.json when available.
      if (message.includes('not a registered configuration') && context) {
        try {
          disabled = await removeBuiltInOllamaFromChatLanguageModels(context);
        } catch (fallbackError) {
          const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
          await win.showErrorMessage(`Failed to disable Copilot's built-in Ollama provider: ${fallbackMessage}`);
          return;
        }
      } else {
        await win.showErrorMessage(`Failed to disable Copilot's built-in Ollama provider: ${message}`);
        return;
      }
    }

    if (!disabled) {
      await win.showErrorMessage(
        'Built-in Ollama provider appears to still be enabled. Please disable it in Chat Language Models settings.',
      );
      return;
    }

    const reloadSelection = await win.showInformationMessage(
      "Copilot's built-in Ollama provider has been disabled. Reload VS Code to apply.",
      'Reload Window',
    );

    if (isSelectedAction(reloadSelection, 'Reload Window')) {
      await commands.executeCommand('workbench.action.reloadWindow');
    }
  } finally {
    builtInOllamaConflictPromptInProgress = false;
  }
}

/**
 * Build and send a message to the language model.
 *
 * When `client` is provided the request is streamed directly from Ollama —
 * completely bypassing the VS Code IPC boundary — giving the @ollama participant
 * true per-token streaming. When `client` is omitted the function falls back to
 * the VS Code LM API path (used in tests and as a backwards-compatibility shim).
 */
export async function handleChatRequest(
  request: vscode.ChatRequest,
  chatContext: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  client?: Ollama,
  outputChannel?: DiagnosticsLogger,
  extensionContext?: vscode.ExtensionContext,
  modelSettings?: ModelSettingsStore,
): Promise<void> {
  const messages: vscode.LanguageModelChatMessage[] = [];

  for (const turn of chatContext.history) {
    if (turn instanceof vscode.ChatRequestTurn) {
      messages.push(vscode.LanguageModelChatMessage.User(turn.prompt));
    } else if (turn instanceof vscode.ChatResponseTurn) {
      const text = turn.response
        .filter((r): r is vscode.ChatResponseMarkdownPart => r instanceof vscode.ChatResponseMarkdownPart)
        .map(r => r.value.value)
        .join('');
      if (text) {
        messages.push(vscode.LanguageModelChatMessage.Assistant(text));
      }
    }
  }

  messages.push(vscode.LanguageModelChatMessage.User(request.prompt));

  if (client) {
    // Direct Ollama path: completely IPC-free, per-token streaming for the @ollama participant.
    let modelId: string;
    if (request.model.vendor === 'ollama' || request.model.vendor === LANGUAGE_MODEL_VENDOR) {
      modelId = toRuntimeModelId(request.model.id);
    } else {
      // Prefer BYOK models (in-process), fall back to our custom provider.
      const byokModels = await vscode.lm.selectChatModels({ vendor: 'ollama' });
      if (byokModels.length) {
        modelId = toRuntimeModelId(byokModels[0].id);
      } else {
        const ourModels = await vscode.lm.selectChatModels({ vendor: LANGUAGE_MODEL_VENDOR });
        if (!ourModels.length) {
          stream.markdown('No Ollama models available. Pull a model first using the Ollama sidebar.');
          return;
        }
        modelId = toRuntimeModelId(ourModels[0].id);
      }
    }

    // Use cloud-authenticated client when the selected model is a cloud model.
    const cloudModelTag = modelId.split(':')[1] ?? '';
    const isCloudModel = cloudModelTag === 'cloud' || cloudModelTag.endsWith('-cloud');
    const effectiveClient = isCloudModel && extensionContext ? await getCloudOllamaClient(extensionContext) : client;

    // Resolve per-model generation overrides (temperature, top_p, top_k, num_ctx, num_predict, think, think_budget).
    const modelOptions = modelSettings ? getModelOptionsForModel(modelSettings, modelId) : {};

    try {
      // Convert VS Code messages to the plain Ollama format expected by the client.
      //
      // XML context tag extraction (mirrors the logic in OllamaChatModelProvider.toOllamaMessages):
      // VS Code Copilot injects structured IDE context (<selection>, <file>, etc.) as leading XML
      // tags in the first user message. These are extracted from the start of user message text
      // only (stopping as soon as a tag does not begin at index 0), collected into systemContextParts,
      // deduplicated by tag name (most-recent wins), then prepended as a single Ollama `system` message.
      // This keeps IDE-injected context separate from the conversational user turn.
      const systemContextParts: string[] = [];

      const ollamaMessages: (Message & { tool_call_id?: string })[] = messages.map(msg => {
        const isUser = msg.role === vscode.LanguageModelChatMessageRole.User;
        let content = (Array.isArray(msg.content) ? msg.content : [])
          .filter((p): p is vscode.LanguageModelTextPart => p instanceof vscode.LanguageModelTextPart)
          .map(p => p.value)
          .join('');
        if (isUser) {
          const split = splitLeadingXmlContextBlocks(content);
          if (split.contextBlocks.length > 0) {
            systemContextParts.push(...split.contextBlocks);
          }
          content = split.content;
        }
        return {
          role: (isUser ? 'user' : 'assistant') as 'user' | 'assistant',
          content,
        };
      });

      const dedupedContextParts = dedupeXmlContextBlocksByTag(systemContextParts);

      if (dedupedContextParts.length > 0) {
        ollamaMessages.unshift({ role: 'system', content: dedupedContextParts.join('\n\n') });
      }

      // Truncate messages to fit within the model's context window.
      // VS Code injects 100K+ token prompts; small models cannot handle this.
      const maxInputTokens = request.model.maxInputTokens ?? 0;
      if (maxInputTokens > 0) {
        const truncated = truncateMessages(ollamaMessages as Message[], maxInputTokens);
        ollamaMessages.splice(0, ollamaMessages.length, ...truncated);
      }

      // Tool invocation loop — only when VS Code tools and an invocation token are available.
      const vscodeLmTools = vscode.lm.tools ?? [];
      let useXmlFallback = false;
      if (vscodeLmTools.length > 0 && request.toolInvocationToken) {
        const ollamaTools: Tool[] = vscodeLmTools.map(t => ({
          type: 'function',
          function: {
            name: t.name,
            description: t.description ?? '',
            parameters: normalizeToolParameters(t.inputSchema),
          },
        }));

        const shouldThinkInToolLoop =
          typeof modelOptions.think === 'boolean' ? modelOptions.think : isThinkingModelId(modelId);
        const MAX_TOOL_ROUNDS = 10;
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          if (token.isCancellationRequested) {
            return;
          }

          let roundResponse: ChatResponse;
          try {
            roundResponse = await (isCloudModel
              ? openAiCompatChatOnce({
                  modelId,
                  messages: ollamaMessages as Message[],
                  tools: ollamaTools,
                  shouldThink: shouldThinkInToolLoop,
                  effectiveClient,
                  extensionContext,
                  modelOptions,
                })
              : nativeSdkChatOnce({
                  modelId,
                  messages: ollamaMessages as Message[],
                  tools: ollamaTools,
                  shouldThink: shouldThinkInToolLoop,
                  effectiveClient,
                  modelOptions,
                }));
          } catch (toolError) {
            if (isToolsNotSupportedError(toolError)) {
              outputChannel?.warn(
                `[client] disabling tools for @ollama request on model ${modelId}: ${String(toolError)}`,
              );
              useXmlFallback = true;
              break;
            }
            throw toolError;
          }

          const toolCalls = roundResponse.message.tool_calls;
          if (!toolCalls?.length) {
            // No tool invocations needed — render the response text and exit.
            if (roundResponse.message.content) {
              stream.markdown(sanitizeNonStreamingModelOutput(roundResponse.message.content));
            }
            return;
          }

          // Append the assistant message (with its tool_calls) to the conversation.
          ollamaMessages.push({
            role: 'assistant',
            content: roundResponse.message.content ?? '',
            tool_calls: toolCalls,
          });

          // Invoke each tool via VS Code's tool API and append result messages.
          let calledTaskComplete = false;
          for (const toolCall of toolCalls) {
            const toolName = toolCall.function.name;
            // task_complete is VS Code's Autopilot signal — invoke it for bookkeeping
            // then break the loop; no tool-result message is needed.
            if (toolName === TASK_COMPLETE_TOOL_NAME) {
              calledTaskComplete = true;
              try {
                await vscode.lm.invokeTool(
                  toolName,
                  {
                    input: toolCall.function.arguments as Record<string, unknown>,
                    toolInvocationToken: request.toolInvocationToken!,
                  },
                  token,
                );
              } catch {
                /* ignore — task_complete failure should not block response */
              }
              break;
            }
            const toolInput = toolCall.function.arguments;
            let resultText: string;
            try {
              const result = await vscode.lm.invokeTool(
                toolName,
                { input: toolInput, toolInvocationToken: request.toolInvocationToken! },
                token,
              );
              resultText = result.content
                .filter((c): c is vscode.LanguageModelTextPart => c instanceof vscode.LanguageModelTextPart)
                .map(c => c.value)
                .join('');
            } catch (invokeError) {
              resultText = invokeError instanceof Error ? invokeError.message : 'Tool execution failed';
            }
            ollamaMessages.push({
              role: 'tool',
              content: resultText,
              tool_name: toolName,
              tool_call_id: (toolCall as { id?: string }).id,
            } as never);
          }

          // task_complete signals the agent is done — display any final content and exit.
          if (calledTaskComplete) {
            if (roundResponse.message.content) {
              stream.markdown(sanitizeNonStreamingModelOutput(roundResponse.message.content));
            }
            return;
          }
        }
        // MAX_TOOL_ROUNDS reached — fall through to the streaming pass below.
      }

      if (useXmlFallback && request.toolInvocationToken) {
        outputChannel?.info(`[client] attempting XML tool call fallback for model ${modelId}`);
        const toolNames = new Set(vscodeLmTools.map(t => t.name));
        const xmlSystemPrompt = buildXmlToolSystemPrompt(vscodeLmTools);
        const existingSystem = (ollamaMessages as Message[]).filter(m => m.role === 'system');
        const nonSystem = (ollamaMessages as Message[]).filter(m => m.role !== 'system');
        const xmlConversation: Message[] = [
          ...existingSystem,
          { role: 'system', content: xmlSystemPrompt },
          ...nonSystem,
        ];

        const MAX_XML_ROUNDS = 5;
        let correctedOnce = false;
        for (let xmlRound = 0; xmlRound < MAX_XML_ROUNDS; xmlRound++) {
          if (token.isCancellationRequested) return;

          const xmlResponse = await (isCloudModel
            ? openAiCompatChatOnce({
                modelId,
                messages: xmlConversation,
                shouldThink: false,
                effectiveClient,
                extensionContext,
                modelOptions,
              })
            : nativeSdkChatOnce({
                modelId,
                messages: xmlConversation,
                shouldThink: false,
                effectiveClient,
                modelOptions,
              }));

          const responseText = xmlResponse.message.content ?? '';
          const xmlToolCalls = extractXmlToolCalls(responseText, toolNames);

          if (!xmlToolCalls.length) {
            if (!correctedOnce && !responseText.trim() && xmlRound < MAX_XML_ROUNDS - 1) {
              correctedOnce = true;
              xmlConversation.push({ role: 'assistant', content: responseText });
              xmlConversation.push({
                role: 'user',
                content:
                  `Your previous response was empty. If you need information, emit a single XML tool call — no markdown fences, no prose. ` +
                  `If you already have enough information, answer in plain text. Available tools: ${[...toolNames].join(', ')}.`,
              });
              continue;
            }
            if (responseText.trim()) {
              stream.markdown(sanitizeNonStreamingModelOutput(responseText));
            }
            return;
          }

          xmlConversation.push({ role: 'assistant', content: responseText });
          // The XML system prompt instructs models to call ONE tool per response.
          // If a model emits multiple tool tags, execute only the first to honour
          // that contract and avoid confusing follow-up context.
          const [xmlToolCall] = xmlToolCalls;
          if (xmlToolCalls.length > 1) {
            outputChannel?.warn(
              `[client] XML fallback extracted ${xmlToolCalls.length} tool calls; executing only the first (${xmlToolCall.name}) to comply with 'ONE tool per response' contract.`,
            );
          }
          let resultText: string;
          try {
            const result = await vscode.lm.invokeTool(
              xmlToolCall.name,
              { input: xmlToolCall.parameters, toolInvocationToken: request.toolInvocationToken! },
              token,
            );
            resultText = result.content
              .filter((c): c is vscode.LanguageModelTextPart => c instanceof vscode.LanguageModelTextPart)
              .map(c => c.value)
              .join('');
          } catch (invokeError) {
            resultText = invokeError instanceof Error ? invokeError.message : 'Tool execution failed';
          }
          // Use 'user' role for tool results in the XML fallback path — models that fail
          // JSON function calling have no training data for the 'tool' role either.
          xmlConversation.push({ role: 'user', content: `[Tool result: ${xmlToolCall.name}]\n${resultText}` });

          correctedOnce = false;
        }
        // MAX_XML_ROUNDS exhausted — fall through to the streaming pass below.
      }

      // Per-model think override: use stored setting if present, fall back to model-ID pattern.
      const shouldThinkInitial =
        typeof modelOptions.think === 'boolean' ? modelOptions.think : isThinkingModelId(modelId);

      // Check if user wants to hide thinking content (only show header)
      const hideThinkingContent = vscode.workspace
        .getConfiguration('ollama')
        .get<boolean>('hideThinkingContent', false);

      let shouldThink = shouldThinkInitial;
      let response: AsyncIterable<ChatResponse>;

      // Choose API path: native Ollama SDK for local models, OpenAI-compat for cloud
      const streamChatFn = isCloudModel
        ? (think: boolean) =>
            openAiCompatStreamChat({
              modelId,
              messages: ollamaMessages as Message[],
              shouldThink: think,
              effectiveClient,
              extensionContext,
              modelOptions,
            })
        : (think: boolean) =>
            nativeSdkStreamChat({
              modelId,
              messages: ollamaMessages as Message[],
              shouldThink: think,
              effectiveClient,
              modelOptions,
            });

      try {
        response = await streamChatFn(shouldThink);
      } catch (chatError) {
        const supportsThinkingError =
          shouldThink &&
          chatError instanceof Error &&
          chatError.name === 'ResponseError' &&
          chatError.message.toLowerCase().includes('does not support thinking');

        if (supportsThinkingError) {
          shouldThink = false;
          response = await streamChatFn(false);
        } else if (isToolsNotSupportedError(chatError)) {
          outputChannel?.warn(`[client] model ${modelId} rejected tools; retrying stream without tools/thinking`);
          shouldThink = false;
          response = await streamChatFn(false);
        } else {
          throw chatError;
        }
      }

      let thinkingStarted = false;
      let contentStarted = false;
      const xmlFilter = createXmlStreamFilter();
      // Parse <think> tags on both cloud and local paths.
      // For local models Ollama normally pre-splits thinking into message.thinking, but
      // some model/version combinations still emit raw <think> tags in message.content.
      // Applying the parser unconditionally is safe: if content is already clean the
      // parser transitions through lookingForOpening → thinkingDone and passes it unchanged.
      const thinkingParser = shouldThink ? new ThinkingParser() : null;

      for await (const chunk of response) {
        if (token.isCancellationRequested) {
          break;
        }

        if (chunk.message?.thinking) {
          if (!thinkingStarted) {
            stream.markdown('\n\n*Thinking*\n\n');
            thinkingStarted = true;
          }
          if (!hideThinkingContent) {
            stream.markdown(chunk.message.thinking);
          }
        }

        if (chunk.message?.content) {
          let thinkingChunk = '';
          let contentChunk = chunk.message.content;

          if (thinkingParser) {
            [thinkingChunk, contentChunk] = thinkingParser.addContent(chunk.message.content);
          }

          if (thinkingChunk) {
            if (!thinkingStarted) {
              stream.markdown('\n\n*Thinking*\n\n');
              thinkingStarted = true;
            }
            if (!hideThinkingContent) {
              stream.markdown(thinkingChunk);
            }
          }

          if (contentChunk) {
            if (thinkingStarted && !contentStarted) {
              stream.markdown('\n\n---\n\n*Response*\n\n');
              contentStarted = true;
            }
            outputChannel?.debug(`[client] @ollama chunk: ${contentChunk.substring(0, 50)}`);
            // Filter context tags using SAX parser - handles incomplete tags across chunk boundaries
            const cleanContent = xmlFilter.write(contentChunk);
            if (cleanContent) {
              stream.markdown(cleanContent);
            }
          }
        }

        if (chunk.message?.tool_calls?.length) {
          for (const toolCall of chunk.message.tool_calls) {
            stream.markdown(
              `\n\`\`\`json\n${JSON.stringify({ tool: toolCall.function.name, arguments: toolCall.function.arguments }, null, 2)}\n\`\`\`\n`,
            );
          }
        }

        if (chunk.done) {
          break;
        }
      }

      // Finalize XML filter to flush any remaining buffer
      const finalContent = xmlFilter.end();
      if (finalContent) {
        stream.markdown(finalContent);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      reportError(outputChannel, 'Chat participant request failed', error, { showToUser: true });
      const isCrashError = error instanceof Error && error.message.includes('model runner has unexpectedly stopped');
      if (isCrashError) {
        // Best-effort unload to keep behaviour consistent with the provider path.
        void effectiveClient.generate({ model: modelId, prompt: '', keep_alive: 0, stream: false }).catch(() => {});
        const selection = await vscode.window.showErrorMessage(
          'The Ollama model runner crashed. Please check the Ollama server logs and restart if needed.',
          'Open Logs',
        );
        if (selection === 'Open Logs') {
          const logsPath = join(homedir(), '.ollama', 'logs', 'server.log');
          try {
            const document = await vscode.workspace.openTextDocument(vscode.Uri.file(logsPath));
            await vscode.window.showTextDocument(document, { preview: false });
          } catch {
            void vscode.window.showWarningMessage(
              `Could not open Ollama logs at ${logsPath}. Please check that the Ollama server is installed and logging is enabled.`,
            );
          }
        }
      }
      stream.markdown(`Error: ${message}`);
    }
    return;
  }

  // VS Code LM API path — used when no client is injected (tests / backwards compat).
  let model: vscode.LanguageModelChat;
  if (request.model.vendor === LANGUAGE_MODEL_VENDOR) {
    model = request.model;
  } else {
    const models = await vscode.lm.selectChatModels({ vendor: LANGUAGE_MODEL_VENDOR });
    if (!models.length) {
      stream.markdown('No Ollama models available. Pull a model first using the Ollama sidebar.');
      return;
    }
    model = models[0];
  }

  try {
    const tools = vscode.lm.tools ?? [];
    const conversationMessages = [...messages];
    const MAX_TOOL_ROUNDS = 10;

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const response = await model.sendRequest(
        conversationMessages,
        tools.length && request.toolInvocationToken
          ? { tools: tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) }
          : {},
        token,
      );

      const pendingToolCalls: vscode.LanguageModelToolCallPart[] = [];
      const assistantTextParts: vscode.LanguageModelTextPart[] = [];
      for await (const chunk of response.stream) {
        if (chunk instanceof vscode.LanguageModelTextPart) {
          assistantTextParts.push(chunk);
        } else if (chunk instanceof vscode.LanguageModelToolCallPart) {
          pendingToolCalls.push(chunk);
        }
      }

      const hasTaskComplete = pendingToolCalls.some(tc => tc.name === TASK_COMPLETE_TOOL_NAME);
      if (pendingToolCalls.length === 0 || !request.toolInvocationToken || hasTaskComplete) {
        // No more tool calls (or task_complete was invoked) — stream buffered text and finish.
        for (const part of assistantTextParts) {
          stream.markdown(part.value);
        }
        // Invoke task_complete for VS Code Autopilot bookkeeping.
        if (hasTaskComplete && request.toolInvocationToken) {
          const tc = pendingToolCalls.find(c => c.name === TASK_COMPLETE_TOOL_NAME)!;
          try {
            await vscode.lm.invokeTool(
              TASK_COMPLETE_TOOL_NAME,
              { input: tc.input as Record<string, unknown>, toolInvocationToken: request.toolInvocationToken },
              token,
            );
          } catch {
            /* ignore */
          }
        }
        break;
      }

      // Append the full assistant turn (text + tool calls) so subsequent rounds have context.
      conversationMessages.push(
        vscode.LanguageModelChatMessage.Assistant([...assistantTextParts, ...pendingToolCalls]),
      );

      const toolResults: vscode.LanguageModelToolResultPart[] = [];
      for (const toolCall of pendingToolCalls) {
        try {
          const result = await vscode.lm.invokeTool(
            toolCall.name,
            { input: toolCall.input as Record<string, unknown>, toolInvocationToken: request.toolInvocationToken },
            token,
          );
          toolResults.push(new vscode.LanguageModelToolResultPart(toolCall.callId, result.content));
        } catch (invokeError) {
          const errMsg = invokeError instanceof Error ? invokeError.message : 'Tool execution failed';
          toolResults.push(
            new vscode.LanguageModelToolResultPart(toolCall.callId, [new vscode.LanguageModelTextPart(errMsg)]),
          );
        }
      }
      conversationMessages.push(vscode.LanguageModelChatMessage.User(toolResults));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    stream.markdown(`Error: ${message}`);
  }
}

export async function activate(context: vscode.ExtensionContext) {
  let logTailProcess: ChildProcessWithoutNullStreams | undefined;
  const noopLogger: DiagnosticsLogger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    exception: () => {},
  };

  const stopLogStreaming = () => {
    if (!logTailProcess) {
      return;
    }

    logTailProcess.kill();
    logTailProcess = undefined;
  };

  const startLogStreaming = (output: Pick<DiagnosticsLogger, 'info' | 'warn' | 'error'>) => {
    stopLogStreaming();

    const onData = (chunk: Buffer, stream: 'stdout' | 'stderr') => {
      const text = chunk.toString('utf8').trim();
      if (!text) {
        return;
      }

      const lines = text
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);
      for (const line of lines) {
        if (stream === 'stderr') {
          output.warn(`[server] ${line}`);
        } else {
          output.info(`[server] ${line}`);
        }
      }
    };

    const platform = process.platform;
    if (platform === 'darwin') {
      const logPath = join(homedir(), '.ollama', 'logs', 'server.log');
      output.info(`[server] starting log stream from ${logPath}`);
      logTailProcess = spawn('tail', ['-n', '200', '-F', logPath], { stdio: 'pipe' });
    } else if (platform === 'linux') {
      output.info('[server] starting log stream from journalctl (-u ollama)');
      logTailProcess = spawn('journalctl', ['-u', 'ollama', '--no-pager', '--follow', '--output', 'cat'], {
        stdio: 'pipe',
      });
    } else if (platform === 'win32') {
      const script =
        '$p=Join-Path $env:LOCALAPPDATA \'Ollama\\server.log\'; if (Test-Path $p) { Get-Content -Path $p -Tail 200 -Wait } else { Write-Error "Missing log file: $p" }';
      output.info('[server] starting log stream from %LOCALAPPDATA%\\Ollama\\server.log');
      logTailProcess = spawn('powershell', ['-NoProfile', '-Command', script], { stdio: 'pipe' });
    } else {
      output.warn(`[server] log streaming not supported on platform: ${platform}`);
      return;
    }

    logTailProcess.stdout.on('data', chunk => onData(chunk, 'stdout'));
    logTailProcess.stderr.on('data', chunk => onData(chunk, 'stderr'));

    logTailProcess.on('error', error => {
      output.error(`[server] log stream process failed: ${error.message}`);
      stopLogStreaming();
    });

    logTailProcess.on('exit', (code, signal) => {
      output.info(`[server] log stream stopped (code=${code ?? 'null'}, signal=${signal ?? 'null'})`);
      logTailProcess = undefined;
    });
  };

  const logOutputChannel =
    typeof vscode.window.createOutputChannel === 'function'
      ? vscode.window.createOutputChannel('Opilot', { log: true })
      : undefined;

  const diagnostics = logOutputChannel
    ? createDiagnosticsLogger(logOutputChannel, () => getConfiguredLogLevel())
    : noopLogger;

  diagnostics.info('[client] activating extension...');

  const client = await getOllamaClient(context);
  const config = vscode.workspace.getConfiguration('ollama');
  const host = config.get<string>('host') || 'http://localhost:11434';
  const autoStartLogStreaming = config.get<boolean>('streamLogs') ?? true;
  diagnostics.info(`[client] configured host: ${host}`);
  diagnostics.info(`[client] auto-start log streaming: ${autoStartLogStreaming ? 'enabled' : 'disabled'}`);
  diagnostics.info(`[client] diagnostics log level: ${getConfiguredLogLevel()}`);

  let modelSettingsStore: ModelSettingsStore = {};
  if (context.globalStorageUri?.fsPath) {
    modelSettingsStore = await loadModelSettings(context.globalStorageUri, diagnostics);
  } else {
    diagnostics.warn('[model-settings] globalStorageUri missing; using in-memory settings only');
  }

  const getAvailableModelNames = async (): Promise<string[]> => {
    const names = new Set<string>(Object.keys(modelSettingsStore));
    try {
      const [local, running] = await Promise.all([client.list(), client.ps()]);
      for (const model of local.models ?? []) {
        if (typeof model?.name === 'string' && model.name.length > 0) {
          names.add(model.name);
        }
      }
      for (const model of running.models ?? []) {
        if (typeof model?.name === 'string' && model.name.length > 0) {
          names.add(model.name);
        }
      }
    } catch (error) {
      diagnostics.exception('[model-settings] failed to collect model list', error);
    }
    return Array.from(names);
  };

  let saveDebounceTimer: ReturnType<typeof setTimeout> | undefined;
  const modelSettingsViewProvider = createModelSettingsViewProvider({
    context,
    initialStore: modelSettingsStore,
    getAvailableModels: getAvailableModelNames,
    onStoreChanged: async nextStore => {
      modelSettingsStore = nextStore;
      if (context.globalStorageUri?.fsPath) {
        // Debounce writes: sliders fire many rapid patches; batch into a single save after 500 ms.
        clearTimeout(saveDebounceTimer);
        saveDebounceTimer = setTimeout(() => {
          void saveModelSettings(context.globalStorageUri, modelSettingsStore, diagnostics);
        }, 500);
      }
    },
    diagnostics,
  });

  diagnostics.info(`[model-settings] Registering webview view provider with ID: ${MODEL_SETTINGS_VIEW_ID}`);
  const modelSettingsViewRegistration =
    typeof vscode.window.registerWebviewViewProvider === 'function'
      ? vscode.window.registerWebviewViewProvider(MODEL_SETTINGS_VIEW_ID, modelSettingsViewProvider, {
          webviewOptions: { retainContextWhenHidden: true },
        })
      : {
          dispose: () => {
            /* noop for tests/mocks */
          },
        };
  diagnostics.info('[model-settings] View provider registered');

  const provider = new OllamaChatModelProvider(context, client, diagnostics);
  let lmProviderDisposable: vscode.Disposable | undefined;
  try {
    lmProviderDisposable = vscode.lm.registerLanguageModelChatProvider(LANGUAGE_MODEL_VENDOR, provider);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('already registered')) {
      diagnostics.warn(
        `[client] language model provider vendor "${LANGUAGE_MODEL_VENDOR}" is already registered; skipping duplicate registration.`,
      );
    } else {
      reportError(diagnostics, 'Language model provider registration failed', error, { showToUser: true });
      throw error;
    }
  }

  // Eagerly populate model capability data so thinking/tools detection is
  // ready before the first chat request rather than waiting for VS Code to
  // lazily call provideLanguageModelChatInformation.
  provider.prefetchModels();

  // Detect and prompt to disable VS Code's built-in Ollama provider (non-blocking)
  void (async () => {
    try {
      await handleBuiltInOllamaConflict(undefined, undefined, undefined, undefined, context);
    } catch (error) {
      diagnostics.debug(
        `[client] Built-in Ollama conflict check failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  })();

  const statusBarRegistration = registerStatusBarHeartbeat(client, host, diagnostics);
  const sidebarRegistration = registerSidebar(context, client, diagnostics, () => {
    provider.refreshModels();
    statusBarRegistration.triggerCheck();
  });

  const subscriptions: vscode.Disposable[] = [
    vscode.commands.registerCommand('opilot.manageAuthToken', async () => {
      await provider.setAuthToken();
    }),
    vscode.commands.registerCommand('opilot.refreshModels', () => {
      provider.refreshModels();
      diagnostics.info('[client] model list refresh triggered');
    }),
    vscode.commands.registerCommand('opilot.openModelSettings', async () => {
      modelSettingsViewProvider.updateStore(modelSettingsStore);
      await modelSettingsViewProvider.open();
    }),
    vscode.commands.registerCommand('opilot.openModelSettingsForModel', async (modelId: unknown) => {
      if (typeof modelId !== 'string' || modelId.length === 0) {
        return;
      }
      modelSettingsViewProvider.updateStore(modelSettingsStore);
      await modelSettingsViewProvider.open(modelId);
    }),
    vscode.commands.registerCommand('opilot.dumpPerformanceSnapshot', () => {
      logPerformanceSnapshot(diagnostics, sidebarRegistration?.getProfilingSnapshot?.());
      void vscode.window.showInformationMessage('Performance snapshot written to Opilot logs');
    }),
    vscode.commands.registerCommand('opilot.checkServerHealth', async () => {
      const isConnected = await testConnection(client);
      if (!isConnected) {
        await handleConnectionTestFailure(host);
      } else {
        void vscode.window.showInformationMessage('Ollama server is reachable.');
      }
    }),
    statusBarRegistration,
    modelSettingsViewRegistration,
    {
      dispose: () => stopLogStreaming(),
    },
    {
      // Flush any pending debounced model-settings save on extension deactivation.
      dispose: () => {
        clearTimeout(saveDebounceTimer);
        if (context.globalStorageUri?.fsPath) {
          void saveModelSettings(context.globalStorageUri, modelSettingsStore, diagnostics);
        }
      },
    },
  ];

  if (lmProviderDisposable) {
    subscriptions.unshift(lmProviderDisposable);
  }

  context.subscriptions.push(...subscriptions);

  // Register modelfile manager
  registerModelfileManager(context, client, diagnostics);

  // Register inline completion provider
  const completionProvider = new OllamaInlineCompletionProvider(client, diagnostics);
  context.subscriptions.push(
    vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, completionProvider),
  );

  // Test connection to Ollama server on startup (non-blocking)
  void (async () => {
    try {
      const isConnected = await testConnection(client);
      diagnostics.info(`[client] Connection test result: ${isConnected ? 'connected' : 'not connected'}`);
      if (!isConnected) {
        await handleConnectionTestFailure(host);
      }
    } catch (error) {
      reportError(diagnostics, 'Connection test failed', error, { showToUser: true });
    }
  })();

  if (logOutputChannel) {
    diagnostics.info('[client] activation complete');
    logPerformanceSnapshot(diagnostics, sidebarRegistration?.getProfilingSnapshot?.(), 'startup');
    if (autoStartLogStreaming) {
      startLogStreaming(diagnostics);
    }

    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(event => {
        handleConfigurationChange(
          event,
          diagnostics,
          () => {
            // Log level change handler
          },
          enabled => {
            // Auto-start log streaming change handler
            if (enabled) {
              startLogStreaming(diagnostics);
            } else {
              stopLogStreaming();
              diagnostics.info('[server] log streaming disabled via settings');
            }
          },
        );
      }),
    );

    context.subscriptions.push(logOutputChannel);
  }

  const participantHandler: vscode.ChatRequestHandler = async (
    request: vscode.ChatRequest,
    chatContext: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
  ): Promise<void> => {
    // Pass the Ollama client so the handler streams directly — no VS Code IPC overhead.
    await handleChatRequest(request, chatContext, stream, token, client, diagnostics, context, modelSettingsStore);
  };

  const participant = setupChatParticipant(context, participantHandler);
  context.subscriptions.push(participant);
}

export function deactivate() {}
