import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promises as fsPromises } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ChatResponse, Message, Ollama, Tool } from 'ollama';
import * as vscode from 'vscode';
import { createVSCodeChatRenderer, mapUsageToVSCode, toVSCodeToolCallPart } from '@agentsy/vscode';
import { nativeSdkChatOnce, nativeSdkStreamChat, openAiCompatChatOnce, openAiCompatStreamChat } from './chatUtils.js';
import { getCloudOllamaClient, getOllamaAuthToken, getOllamaClient, getOllamaHost, testConnection } from './client.js';
import { OllamaInlineCompletionProvider } from './completions.js';
import { BASE_SYSTEM_PROMPT, detectsRepetition, renderOllamaPrompt, resolveContextLimit } from './contextUtils.js';
import { createDiagnosticsLogger, getConfiguredLogLevel, type DiagnosticsLogger } from './diagnostics.js';
import { reportError } from './errorHandler.js';
import {
  handleConfigurationChange,
  handleConnectionTestFailure,
  isSelectedAction,
  redactDisplayHost,
} from './extensionHelpers.js';
import {
  createXmlStreamFilter,
  dedupeXmlContextBlocksByTag,
  sanitizeNonStreamingModelOutput,
  splitLeadingXmlContextBlocks,
} from './formatting';
import { formatBytes } from './formatUtils.js';
import { registerModelfileManager } from './modelfiles.js';
import {
  getModelOptionsForModel,
  loadModelSettings,
  saveModelSettings,
  type ModelOptionOverrides,
  type ModelSettingsStore,
} from './modelSettings.js';
import type { ResolvedReference } from './prompts/OllamaPrompt.js';
import { isThinkingModelId, OllamaChatModelProvider } from './provider.js';
import { getSetting, migrateLegacySettingsWithState } from './settings.js';
import { createModelSettingsViewProvider, MODEL_SETTINGS_VIEW_ID } from './settingsWebview.js';
import { registerSidebar, type SidebarProfilingSnapshot } from './sidebar.js';
import { registerStatusBarHeartbeat } from './statusBar.js';
import { ThinkingParser } from './thinkingParser.js';
import {
  buildNativeToolsArray,
  buildXmlToolSystemPrompt,
  extractXmlToolCalls,
  isToolsNotSupportedError,
} from './toolUtils.js';
import {
  createTitleProvider,
  createSummarizer,
  getHelpTextPrefix,
  getAdditionalWelcomeMessage,
  createFollowupProvider,
  createParticipantVariableProvider,
  createParticipantDetectionProvider,
} from './participantFeatures.js';
import { createChatStatusItem, disposeChatStatusItem } from './chatStatusItem.js';
import { registerChatCustomizationProvider } from './chatCustomizationProvider.js';

const LANGUAGE_MODEL_VENDOR = 'selfagency-opilot';
const PROVIDER_MODEL_ID_PREFIX = 'ollama:';
const HERMES_MODEL_PATTERN = /qwen2\.5|qwen3|qwq/i;

/** VS Code Autopilot signals task completion by having the model call this tool. */
const TASK_COMPLETE_TOOL_NAME = 'task_complete';
let builtInOllamaConflictPromptInProgress = false;

type ChatParticipantDetectionRegistrationApi = {
  registerChatParticipantDetectionProvider?: (
    id: string,
    provider: { detectChatParticipant?(input: string): boolean },
  ) => vscode.Disposable;
};

export function toRuntimeModelId(modelId: string): string {
  return modelId.startsWith(PROVIDER_MODEL_ID_PREFIX) ? modelId.slice(PROVIDER_MODEL_ID_PREFIX.length) : modelId;
}

export { mapOpenAiToolCallsToOllamaLike } from './chatUtils.js';
export {
  getOllamaServerLogPath,
  handleConfigurationChange,
  handleConnectionTestFailure,
  isLocalHost,
  isSelectedAction,
} from './extensionHelpers.js';
export { formatBytes } from './formatUtils.js';

export function getWindowsLogTailPowerShellArgs(
  localAppData: string | undefined = process.env['LOCALAPPDATA'],
): string[] {
  const logPath = localAppData ? join(localAppData, 'Ollama', 'server.log') : '$env:LOCALAPPDATA\\Ollama\\server.log';
  const escapedLogPath = logPath.replace(/'/g, "''");
  const script =
    `$p='${escapedLogPath}'; ` +
    'if (Test-Path -LiteralPath $p) { Get-Content -LiteralPath $p -Tail 200 -Wait } ' +
    'else { Write-Error ("Missing log file: " + $p) }';

  return ['-NoProfile', '-Command', script];
}

// normalizeToolParameters/isToolsNotSupportedError moved to src/toolUtils.ts

async function tryUpdateChatLanguageModelsFile(modelsPath: string, maxRetries: number): Promise<boolean> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const raw = await fsPromises.readFile(modelsPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        break;
      }

      const filtered = parsed.filter(
        item => !(item && typeof item === 'object' && (item as Record<string, unknown>).vendor === 'ollama'),
      );

      if (filtered.length === parsed.length) {
        break;
      }

      const latestRaw = await fsPromises.readFile(modelsPath, 'utf8');
      if (latestRaw !== raw) {
        if (attempt < maxRetries - 1) {
          continue;
        }
        break;
      }

      await fsPromises.writeFile(modelsPath, `${JSON.stringify(filtered, null, 2)}\n`, 'utf8');
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[opilot] failed to update chat language models file (${modelsPath}): ${message}`);
      break;
    }
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.debug(`[opilot] skipping profiles directory scan for ${userDir}: ${message}`);
    }
  }

  const MAX_WRITE_RETRIES = 3;
  let changed = false;

  for (const modelsPath of candidatePaths) {
    if (await tryUpdateChatLanguageModelsFile(modelsPath, MAX_WRITE_RETRIES)) {
      changed = true;
    }
  }

  return changed;
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
/**
 * Set up chat participant with icon and register it
 */
export async function setupChatParticipant(
  context: vscode.ExtensionContext,
  participantHandler: vscode.ChatRequestHandler,
  chatApi?: Pick<typeof vscode.chat, 'createChatParticipant'>,
  client?: Ollama,
  diagnostics?: DiagnosticsLogger,
): Promise<vscode.Disposable> {
  const chat = chatApi || vscode.chat;
  const chatDetectionApi = vscode.chat as unknown as ChatParticipantDetectionRegistrationApi;
  const participantRecord = (value: vscode.ChatParticipant) => value as unknown as Record<string, unknown>;

  const setOptionalParticipantFeature = (featureName: string, value: unknown) => {
    try {
      participantRecord(participant)[featureName] = value;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      diagnostics?.debug?.(`[participantFeatures] skipping ${featureName}: ${message}`);
    }
  };

  const participant = chat.createChatParticipant('opilot.ollama', participantHandler);
  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'logo.png');
  participant.helpTextPrefix = getHelpTextPrefix();

  // Phase 5: Wire up Chat Participant providers
  if (client && diagnostics) {
    const modelId = getSetting<string>('selectedModel', 'llama3.2');
    const serverHost = getSetting<string>('host', 'http://localhost:11434');

    // Title provider
    const titleProvider = createTitleProvider({
      client,
      diagnostics,
      modelId,
      serverHost,
    });
    setOptionalParticipantFeature('titleProvider', titleProvider);

    // Summarizer
    const summarizer = createSummarizer({
      client,
      diagnostics,
      modelId,
      serverHost,
    });
    setOptionalParticipantFeature('summarizer', summarizer);

    // Welcome message
    setOptionalParticipantFeature(
      'additionalWelcomeMessage',
      await getAdditionalWelcomeMessage({
        client,
        diagnostics,
        modelId,
        serverHost,
      }),
    );

    // Followup provider
    const followupProvider = createFollowupProvider();
    setOptionalParticipantFeature('followupProvider', followupProvider);

    // Variable completions
    const varProvider = createParticipantVariableProvider({
      client,
      diagnostics,
      modelId,
      serverHost,
    });
    setOptionalParticipantFeature('participantVariableProvider', varProvider);

    // Phase 5.7: Detection provider
    const detectionProvider = createParticipantDetectionProvider();
    if (typeof chatDetectionApi.registerChatParticipantDetectionProvider === 'function') {
      chatDetectionApi.registerChatParticipantDetectionProvider('opilot.ollama', detectionProvider);
    }
  }

  return participant;
}

/**
 * Detect and offer to disable Copilot's conflicting built-in Ollama provider.
 * Detects via LM models registered under vendor 'ollama'.
 */
async function disableBuiltInOllamaProvider(
  ws: Pick<typeof vscode.workspace, 'getConfiguration'>,
  win: Pick<typeof vscode.window, 'showErrorMessage'>,
  context?: Pick<vscode.ExtensionContext, 'globalStorageUri'>,
): Promise<boolean> {
  try {
    await (ws.getConfiguration('github.copilot.chat') as vscode.WorkspaceConfiguration).update(
      'ollama.url',
      '',
      vscode.ConfigurationTarget.Global,
    );
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('not a registered configuration') && context) {
      try {
        return await removeBuiltInOllamaFromChatLanguageModels(context);
      } catch (fallbackError) {
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        await win.showErrorMessage(`Failed to disable Copilot's built-in Ollama provider: ${fallbackMessage}`);
        return false;
      }
    } else {
      await win.showErrorMessage(`Failed to disable Copilot's built-in Ollama provider: ${message}`);
      return false;
    }
  }
}

async function promptDisableBuiltInProvider(win: Pick<typeof vscode.window, 'showWarningMessage'>): Promise<boolean> {
  const selection = await win.showWarningMessage(
    "Copilot's built-in Ollama provider is active and will show duplicate models alongside this extension. Disable it?",
    'Disable Built-in Ollama Provider',
  );
  return isSelectedAction(selection, 'Disable Built-in Ollama Provider');
}

async function promptReloadAfterDisable(
  win: Pick<typeof vscode.window, 'showInformationMessage'>,
  commands: Pick<typeof vscode.commands, 'executeCommand'>,
): Promise<void> {
  const reloadSelection = await win.showInformationMessage(
    "Copilot's built-in Ollama provider has been disabled. Reload VS Code to apply.",
    'Reload Window',
  );

  if (isSelectedAction(reloadSelection, 'Reload Window')) {
    await commands.executeCommand('workbench.action.reloadWindow');
  }
}

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
    if (!(await promptDisableBuiltInProvider(win))) return;

    const disabled = await disableBuiltInOllamaProvider(ws, win, context);

    if (!disabled) {
      await win.showErrorMessage(
        'Built-in Ollama provider appears to still be enabled. Please disable it in Chat Language Models settings.',
      );
      return;
    }

    await promptReloadAfterDisable(win, commands);
  } finally {
    builtInOllamaConflictPromptInProgress = false;
  }
}

/** Extract tool calls and assistant text from the model response stream. */
async function extractToolCallsAndText(
  response: unknown,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  outputChannel?: DiagnosticsLogger,
): Promise<{
  pendingToolCalls: vscode.LanguageModelToolCallPart[];
  assistantTextParts: vscode.LanguageModelTextPart[];
}> {
  const pendingToolCalls: vscode.LanguageModelToolCallPart[] = [];
  const assistantTextParts: vscode.LanguageModelTextPart[] = [];
  const streamIterable = (response as { stream: AsyncIterable<unknown> }).stream;
  try {
    for await (const chunk of streamIterable) {
      if (token.isCancellationRequested) {
        break;
      }

      if (chunk instanceof vscode.LanguageModelTextPart) {
        assistantTextParts.push(chunk);
        stream.markdown(chunk.value);
      } else if (chunk instanceof vscode.LanguageModelToolCallPart) {
        pendingToolCalls.push(chunk);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outputChannel?.warn(`[client] LM stream iteration failed: ${message}`);
    throw new Error(`Language model stream interrupted: ${message}`);
  }
  return { pendingToolCalls, assistantTextParts };
}

/** Handle task_complete tool invocation. */
async function handleTaskCompleteToolInvocation(
  toolCall: vscode.LanguageModelToolCallPart,
  request: vscode.ChatRequest,
  token: vscode.CancellationToken,
  outputChannel?: DiagnosticsLogger,
): Promise<void> {
  try {
    await vscode.lm.invokeTool(
      TASK_COMPLETE_TOOL_NAME,
      { input: toolCall.input as Record<string, unknown>, toolInvocationToken: request.toolInvocationToken },
      token,
    );
  } catch (taskCompleteError) {
    const message = taskCompleteError instanceof Error ? taskCompleteError.message : String(taskCompleteError);
    outputChannel?.warn(`[client] task_complete invocation failed (vscode-lm path): ${message}`);
  }
}

/** Invoke all tool calls and collect results. */
async function invokeAllTools(
  toolCalls: vscode.LanguageModelToolCallPart[],
  request: vscode.ChatRequest,
  token: vscode.CancellationToken,
): Promise<vscode.LanguageModelToolResultPart[]> {
  const toolResults: vscode.LanguageModelToolResultPart[] = [];
  for (const toolCall of toolCalls) {
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
  return toolResults;
}

async function runToolRound(
  model: vscode.LanguageModelChat,
  conversationMessages: vscode.LanguageModelChatMessage[],
  tools: readonly vscode.LanguageModelToolInformation[],
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  outputChannel?: DiagnosticsLogger,
): Promise<boolean> {
  const response = await model.sendRequest(
    conversationMessages,
    tools.length && request.toolInvocationToken
      ? { tools: tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) }
      : {},
    token,
  );

  const { pendingToolCalls, assistantTextParts } = await extractToolCallsAndText(
    response,
    stream,
    token,
    outputChannel,
  );

  const hasTaskComplete = pendingToolCalls.some(tc => tc.name === TASK_COMPLETE_TOOL_NAME);
  if (pendingToolCalls.length === 0 || !request.toolInvocationToken || hasTaskComplete) {
    if (hasTaskComplete && request.toolInvocationToken) {
      const taskCompleteCall = pendingToolCalls.find(call => call.name === TASK_COMPLETE_TOOL_NAME);
      if (taskCompleteCall) {
        await handleTaskCompleteToolInvocation(taskCompleteCall, request, token, outputChannel);
      }
    }
    return true;
  }

  conversationMessages.push(vscode.LanguageModelChatMessage.Assistant([...assistantTextParts, ...pendingToolCalls]));

  const toolResults = await invokeAllTools(pendingToolCalls, request, token);
  conversationMessages.push(vscode.LanguageModelChatMessage.User(toolResults));
  return false;
}

async function handleVsCodeLmRequest(
  request: vscode.ChatRequest,
  messages: vscode.LanguageModelChatMessage[],
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  outputChannel?: DiagnosticsLogger,
): Promise<void> {
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
      const shouldBreak = await runToolRound(model, conversationMessages, tools, request, stream, token, outputChannel);
      if (shouldBreak) break;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    stream.markdown(`Error: ${message}`);
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
    await handleDirectOllamaRequest(request, messages, {
      stream,
      token,
      client,
      outputChannel,
      extensionContext,
      modelSettings,
    });
    return;
  }

  // VS Code LM API path — used when no client is injected (tests / backwards compat).
  await handleVsCodeLmRequest(request, messages, stream, token, outputChannel);
}

/**
 * Resolve VS Code chat prompt references (dragged-in files/selections/strings) to plain text.
 * References that cannot be read are silently skipped.
 */
async function resolvePromptReferences(
  references: ReadonlyArray<vscode.ChatPromptReference>,
  outputChannel?: DiagnosticsLogger,
): Promise<ResolvedReference[]> {
  const resolved: ResolvedReference[] = [];
  for (const ref of references) {
    try {
      const { value } = ref;
      if (value instanceof vscode.Uri) {
        const bytes = await vscode.workspace.fs.readFile(value);
        resolved.push({ label: value.fsPath, content: Buffer.from(bytes).toString('utf-8') });
      } else if (value instanceof vscode.Location) {
        const doc = await vscode.workspace.openTextDocument(value.uri);
        const text = doc.getText(value.range);
        const start = value.range.start.line + 1;
        const end = value.range.end.line + 1;
        resolved.push({ label: `${value.uri.fsPath}:${start}-${end}`, content: text });
      } else if (typeof value === 'string' && value.length > 0) {
        resolved.push({ label: ref.id, content: value });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      outputChannel?.debug(`[context] skipping unreadable prompt reference ${ref.id}: ${message}`);
    }
  }
  return resolved;
}

/**
 * Request context to reduce parameter passing in handleDirectOllamaRequest
 */
interface DirectOllamaRequestContext {
  stream: vscode.ChatResponseStream;
  token: vscode.CancellationToken;
  client: Ollama;
  outputChannel?: DiagnosticsLogger;
  extensionContext?: vscode.ExtensionContext;
  modelSettings?: ModelSettingsStore;
}

/**
 * Invokes a single tool and returns the result text.
 * Handles task_complete specially as a no-op signal.
 */
/** Validate that tool arguments are a plain object (not null, array, string, etc.) */
function isValidToolArguments(args: unknown): args is Record<string, unknown> {
  return args !== null && typeof args === 'object' && !Array.isArray(args) && args.constructor === Object;
}

async function invokeSingleTool(
  toolCall: { function: { name: string; arguments: unknown }; id?: string },
  request: vscode.ChatRequest,
  token: vscode.CancellationToken,
  outputChannel?: DiagnosticsLogger,
): Promise<{ resultText: string; isTaskComplete: boolean }> {
  const toolName = toolCall.function.name;
  const isTaskComplete = toolName === TASK_COMPLETE_TOOL_NAME;

  // Validate tool arguments before invoking
  if (!isValidToolArguments(toolCall.function.arguments)) {
    const msg = `invalid tool arguments for ${toolName}: expected plain object, got ${typeof toolCall.function.arguments}`;
    outputChannel?.warn(`[client] ${msg}`);
    return { resultText: msg, isTaskComplete: false };
  }

  if (isTaskComplete) {
    try {
      await vscode.lm.invokeTool(
        toolName,
        {
          input: toolCall.function.arguments,
          toolInvocationToken: request.toolInvocationToken!,
        },
        token,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      outputChannel?.warn(`[client] task_complete invocation failed (native path): ${msg}`);
    }
    return { resultText: '', isTaskComplete: true };
  }

  try {
    const result = await vscode.lm.invokeTool(
      toolName,
      {
        input: toolCall.function.arguments,
        toolInvocationToken: request.toolInvocationToken!,
      },
      token,
    );
    const resultText = result.content
      .filter((c): c is vscode.LanguageModelTextPart => c instanceof vscode.LanguageModelTextPart)
      .map(c => c.value)
      .join('');
    return { resultText, isTaskComplete: false };
  } catch (err) {
    const resultText = err instanceof Error ? err.message : 'Tool execution failed';
    return { resultText, isTaskComplete: false };
  }
}

interface ToolLoopContext {
  isCloudModel: boolean;
  modelId: string;
  ollamaMessages: Array<Message | { role: 'tool'; content: string; tool_name: string; tool_call_id?: string }>;
  ollamaTools: Tool[];
  shouldThinkInToolLoop: boolean;
  effectiveClient: Ollama;
  baseUrl: string | undefined;
  authToken: string | undefined;
  modelOptions: ModelOptionOverrides;
  logOpenAiCompatFallback: (mode: 'stream' | 'once', modelId: string, error: unknown) => void;
  request: vscode.ChatRequest;
  stream: vscode.ChatResponseStream;
  token: vscode.CancellationToken;
  outputChannel?: DiagnosticsLogger;
}

function reportThinkingProgressSafely(stream: vscode.ChatResponseStream, text: string): boolean {
  const maybe = stream as unknown as { thinkingProgress?: (delta: { text?: string }) => void };
  if (typeof maybe.thinkingProgress !== 'function') {
    return false;
  }
  maybe.thinkingProgress({ text });
  return true;
}

function reportWarningSafely(stream: vscode.ChatResponseStream, message: string): boolean {
  const maybe = stream as unknown as { warning?: (warning: string) => void };
  if (typeof maybe.warning !== 'function') {
    return false;
  }
  maybe.warning(message);
  return true;
}

function reportUsageSafely(
  stream: vscode.ChatResponseStream,
  usage: { promptTokens?: number; completionTokens?: number },
): void {
  const maybe = stream as unknown as {
    usage?: (value: { promptTokens: number; completionTokens: number }) => void;
  };
  if (typeof maybe.usage !== 'function') {
    return;
  }
  if (typeof usage.promptTokens !== 'number' || typeof usage.completionTokens !== 'number') {
    return;
  }
  maybe.usage({ promptTokens: usage.promptTokens, completionTokens: usage.completionTokens });
}

function beginToolInvocationSafely(stream: vscode.ChatResponseStream, toolCallId: string, toolName: string): boolean {
  const maybe = stream as unknown as {
    beginToolInvocation?: (toolCallId: string, toolName: string) => void;
  };
  if (typeof maybe.beginToolInvocation !== 'function') {
    return false;
  }
  maybe.beginToolInvocation(toolCallId, toolName);
  return true;
}

function updateToolInvocationSafely(
  stream: vscode.ChatResponseStream,
  toolCallId: string,
  streamData: { arguments: string },
): boolean {
  const maybe = stream as unknown as {
    updateToolInvocation?: (toolCallId: string, streamData: { arguments: string }) => void;
  };
  if (typeof maybe.updateToolInvocation !== 'function') {
    return false;
  }
  maybe.updateToolInvocation(toolCallId, streamData);
  return true;
}

/**
 * Execute the native tool calling loop — handles tool invocation rounds.
 * Returns true if the conversation completed (via task_complete or no more tool calls).
 * Returns false if tools are not supported (triggers XML fallback).
 */
async function executeToolCallingLoop(ctx: ToolLoopContext): Promise<boolean> {
  const {
    isCloudModel,
    modelId,
    ollamaMessages,
    ollamaTools,
    shouldThinkInToolLoop,
    effectiveClient,
    baseUrl,
    authToken,
    modelOptions,
    logOpenAiCompatFallback,
    request,
    stream,
    token,
    outputChannel,
  } = ctx;
  const MAX_TOOL_ROUNDS = 10;
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    if (token.isCancellationRequested) return true;

    let roundResponse: ChatResponse;
    try {
      roundResponse = await (isCloudModel
        ? openAiCompatChatOnce({
            modelId,
            messages: ollamaMessages as Message[],
            tools: ollamaTools,
            shouldThink: shouldThinkInToolLoop,
            effectiveClient,
            baseUrl: baseUrl!,
            authToken,
            modelOptions,
            onOpenAiCompatFallback: logOpenAiCompatFallback,
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
        outputChannel?.warn(`[client] disabling tools for @ollama request on model ${modelId}: ${String(toolError)}`);
        return false; // Signal to use XML fallback
      }
      throw toolError;
    }

    const toolCalls = roundResponse.message.tool_calls;
    if (!toolCalls?.length) {
      if (roundResponse.message.content) {
        stream.markdown(sanitizeNonStreamingModelOutput(roundResponse.message.content));
      }
      return true; // Conversation complete
    }

    ollamaMessages.push({
      role: 'assistant',
      content: roundResponse.message.content ?? '',
      tool_calls: toolCalls,
    });

    let taskCompleted = false;
    for (const toolCall of toolCalls) {
      const { resultText, isTaskComplete } = await invokeSingleTool(toolCall, request, token, outputChannel);
      if (isTaskComplete) {
        taskCompleted = true;
        break;
      }
      ollamaMessages.push({
        role: 'tool',
        content: resultText,
        tool_name: toolCall.function.name,
        tool_call_id: (toolCall as { id?: string }).id,
      });
    }

    if (taskCompleted) {
      if (roundResponse.message.content) {
        stream.markdown(sanitizeNonStreamingModelOutput(roundResponse.message.content));
      }
      return true; // Agent signaled completion
    }
  }

  return true; // MAX_TOOL_ROUNDS reached
}

/** Convert VS Code messages to Ollama format with context block extraction. */
function convertMessagesToOllamaFormat(messages: vscode.LanguageModelChatMessage[]): {
  ollamaMessages: Array<Message | { role: 'tool'; content: string; tool_call_id?: string }>;
  systemContextParts: string[];
} {
  const systemContextParts: string[] = [];
  const ollamaMessages: Array<Message | { role: 'tool'; content: string; tool_call_id?: string }> = messages.map(
    msg => {
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
    },
  );
  return { ollamaMessages, systemContextParts };
}

/** Handle XML tool fallback path for models that don't support native tool calling. Returns true if fallback completed successfully. */
async function handleXmlToolFallback(options: {
  modelId: string;
  isCloudModel: boolean;
  ollamaMessages: Array<Message | { role: 'tool'; content: string; tool_call_id?: string }>;
  vscodeLmTools: readonly vscode.LanguageModelToolInformation[];
  request: vscode.ChatRequest;
  stream: vscode.ChatResponseStream;
  token: vscode.CancellationToken;
  effectiveClient: Ollama;
  baseUrl: string | undefined;
  authToken: string | undefined;
  modelOptions: ModelOptionOverrides;
  logOpenAiCompatFallback: (mode: 'stream' | 'once', modelId: string, error: unknown) => void;
  outputChannel?: DiagnosticsLogger;
}): Promise<boolean> {
  const {
    modelId,
    isCloudModel,
    ollamaMessages,
    vscodeLmTools,
    request,
    stream,
    token,
    effectiveClient,
    baseUrl,
    authToken,
    modelOptions,
    logOpenAiCompatFallback,
    outputChannel,
  } = options;

  outputChannel?.info(`[client] attempting XML tool call fallback for model ${modelId}`);
  const toolNames = new Set(vscodeLmTools.map(t => t.name));
  const toolCallFormat = HERMES_MODEL_PATTERN.test(modelId) ? 'hermes' : 'xml';
  const xmlSystemPrompt = buildXmlToolSystemPrompt(vscodeLmTools, { format: toolCallFormat });
  const existingSystem = (ollamaMessages as Message[]).filter(m => m.role === 'system');
  const nonSystem = (ollamaMessages as Message[]).filter(m => m.role !== 'system');
  const xmlConversation: Message[] = [...existingSystem, { role: 'system', content: xmlSystemPrompt }, ...nonSystem];

  const MAX_XML_ROUNDS = 5;
  let correctedOnce = false;
  for (let xmlRound = 0; xmlRound < MAX_XML_ROUNDS; xmlRound++) {
    if (token.isCancellationRequested) return true;

    const xmlResponse = await (isCloudModel
      ? openAiCompatChatOnce({
          modelId,
          messages: xmlConversation,
          shouldThink: false,
          effectiveClient,
          baseUrl: baseUrl!,
          authToken,
          modelOptions,
          onOpenAiCompatFallback: logOpenAiCompatFallback,
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

    if (xmlToolCalls.length === 0) {
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
      return true; // XML fallback completed successfully
    }

    xmlConversation.push({ role: 'assistant', content: responseText });
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
    xmlConversation.push({ role: 'user', content: `[Tool result: ${xmlToolCall.name}]\n${resultText}` });
    correctedOnce = false;
  }
  // MAX_XML_ROUNDS exhausted — fall through to streaming
  return false;
}

/** Stream model response with thinking and tool call handling. */
async function streamModelResponse(options: {
  modelId: string;
  isCloudModel: boolean;
  ollamaMessages: Array<Message | { role: 'tool'; content: string; tool_call_id?: string }>;
  modelOptions: ModelOptionOverrides;
  shouldThinkInitial: boolean;
  effectiveClient: Ollama;
  baseUrl: string | undefined;
  authToken: string | undefined;
  stream: vscode.ChatResponseStream;
  token: vscode.CancellationToken;
  outputChannel?: DiagnosticsLogger;
  logOpenAiCompatFallback: (mode: 'stream' | 'once', modelId: string, error: unknown) => void;
}): Promise<void> {
  const {
    modelId,
    isCloudModel,
    ollamaMessages,
    modelOptions,
    shouldThinkInitial,
    effectiveClient,
    baseUrl,
    authToken,
    stream,
    token,
    outputChannel,
    logOpenAiCompatFallback,
  } = options;

  const hideThinkingContent = getSetting<boolean>('hideThinkingContent', false);
  const renderer = createVSCodeChatRenderer({
    stream: stream as unknown as Parameters<typeof createVSCodeChatRenderer>[0]['stream'],
    showThinking: false,
  });

  const writeMarkdown = async (text: string) => {
    try {
      await renderer.write(text);
    } catch (error) {
      outputChannel?.debug(`[client] renderer write failed; falling back to stream.markdown: ${String(error)}`);
      stream.markdown(text);
    }
  };

  const endRenderer = async () => {
    try {
      await renderer.end();
    } catch (error) {
      outputChannel?.debug(`[client] renderer end failed: ${String(error)}`);
    }
  };

  let shouldThink = shouldThinkInitial;
  let response: AsyncIterable<ChatResponse>;

  // Choose API path based on model location
  const streamChatFn = isCloudModel
    ? (think: boolean) =>
        openAiCompatStreamChat({
          modelId,
          messages: ollamaMessages as Message[],
          shouldThink: think,
          effectiveClient,
          baseUrl: baseUrl!,
          authToken,
          modelOptions,
          onOpenAiCompatFallback: logOpenAiCompatFallback,
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
  let emittedContent = false;
  let responseBuffer = '';
  const rawRepSensitivity = getSetting<string>('repetitionDetection', 'conservative');
  const repSensitivity: 'off' | 'conservative' | 'moderate' =
    rawRepSensitivity === 'off' || rawRepSensitivity === 'conservative' || rawRepSensitivity === 'moderate'
      ? rawRepSensitivity
      : 'conservative';
  const xmlFilter = createXmlStreamFilter();
  const thinkingParser = shouldThink ? ThinkingParser.forModel(modelId) : null;

  try {
    for await (const chunk of response) {
      if (token.isCancellationRequested) {
        break;
      }

      if (chunk.message?.thinking) {
        if (!thinkingStarted) {
          await writeMarkdown('\n\n*Thinking*\n\n');
          thinkingStarted = true;
          emittedContent = true;
        }
        if (!hideThinkingContent) {
          await writeMarkdown(chunk.message.thinking);
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
            thinkingStarted = true;
            emittedContent = true;
          }
          if (!hideThinkingContent) {
            try {
              // Phase 2: Use native thinkingProgress instead of markdown
              if (!reportThinkingProgressSafely(stream, thinkingChunk)) {
                throw new Error('thinkingProgress API unavailable');
              }
            } catch (error) {
              outputChannel?.debug(`[client] thinkingProgress unavailable; using markdown fallback: ${String(error)}`);
              // Fallback to markdown if thinkingProgress not available
              await writeMarkdown(thinkingChunk);
            }
          }
        }

        if (contentChunk) {
          if (thinkingStarted && !contentStarted) {
            await writeMarkdown('\n\n---\n\n*Response*\n\n');
            contentStarted = true;
          }
          outputChannel?.debug(`[client] @ollama chunk: ${contentChunk.substring(0, 50)}`);
          const cleanContent = xmlFilter.write(contentChunk);
          if (cleanContent) {
            try {
              await writeMarkdown(cleanContent);
            } catch (err) {
              outputChannel?.warn(`[client] stream write failed: ${err instanceof Error ? err.message : String(err)}`);
              break;
            }
            emittedContent = true;
            responseBuffer = (responseBuffer + cleanContent).slice(-600);
            if (detectsRepetition(responseBuffer, repSensitivity)) {
              outputChannel?.warn(`[client] repetition detected in @ollama response; stopping stream`);
              try {
                // Phase 2: Use native warning instead of markdown
                if (!reportWarningSafely(stream, 'Repetition detected — stopping response')) {
                  throw new Error('warning API unavailable');
                }
              } catch (error) {
                outputChannel?.debug(`[client] warning API unavailable; using markdown fallback: ${String(error)}`);
                // Fallback to markdown
                await writeMarkdown('\n\n*\\[Stopped: repetition detected\\]*');
              }
              break;
            }
          }
        }
      }

      if (chunk.message?.tool_calls?.length) {
        for (let tcIdx = 0; tcIdx < chunk.message.tool_calls.length; tcIdx++) {
          const toolCall = chunk.message.tool_calls[tcIdx];
          if (!toolCall) {
            continue;
          }
          const maybeToolCallId = (toolCall as { id?: unknown }).id;
          const toolCallId = typeof maybeToolCallId === 'string' ? maybeToolCallId : undefined;
          const toolCallPart = toVSCodeToolCallPart(
            {
              type: 'tool_call',
              call: {
                name: toolCall.function.name,
                parameters: (toolCall.function.arguments ?? {}) as Record<string, unknown>,
                format: 'native-json',
                ...(toolCallId ? { id: toolCallId } : {}),
              },
              state: 'complete',
            } as Parameters<typeof toVSCodeToolCallPart>[0],
            {
              fallbackCallId: () => `${toolCall.function.name}-${tcIdx}`,
            },
          );
          beginToolInvocationSafely(stream, toolCallPart.callId, toolCallPart.name);
          if (Object.keys(toolCallPart.input).length > 0) {
            updateToolInvocationSafely(stream, toolCallPart.callId, {
              arguments: JSON.stringify(toolCallPart.input),
            });
          }
          emittedContent = true;
        }
      }

      if (chunk.done) {
        const usage = mapUsageToVSCode({
          inputTokens: chunk.prompt_eval_count,
          outputTokens: chunk.eval_count,
          totalTokens:
            typeof chunk.prompt_eval_count === 'number' && typeof chunk.eval_count === 'number'
              ? chunk.prompt_eval_count + chunk.eval_count
              : undefined,
        });
        if (usage) {
          reportUsageSafely(stream, usage);
        }
        break;
      }
    }
  } catch (streamError) {
    const message = streamError instanceof Error ? streamError.message : String(streamError);
    outputChannel?.warn(`[client] @ollama stream iteration failed for ${modelId}: ${message}`);
    await writeMarkdown('\n\n*Response interrupted by a streaming error. Please retry.*');
  }

  // Flush ThinkingParser to drain any partially-buffered state
  if (thinkingParser) {
    const [flushedThinking, flushedContent] = thinkingParser.flush();
    if (flushedThinking && !hideThinkingContent) {
      try {
        await writeMarkdown(flushedThinking);
      } catch (error) {
        outputChannel?.debug(`[client] failed to flush thinking chunk: ${String(error)}`);
      }
    }
    if (flushedContent) {
      const cleanFlushed = xmlFilter.write(flushedContent);
      if (cleanFlushed) {
        try {
          await writeMarkdown(cleanFlushed);
        } catch (error) {
          outputChannel?.debug(`[client] failed to flush content chunk: ${String(error)}`);
        }
        emittedContent = true;
      }
    }
  }

  // Finalize XML filter
  const finalContent = xmlFilter.end();
  if (finalContent) {
    try {
      await writeMarkdown(finalContent);
    } catch (error) {
      outputChannel?.debug(`[client] failed to flush final stream content: ${String(error)}`);
    }
    emittedContent = true;
  }

  // Retry fallback if no content was emitted
  if (!emittedContent && !token.isCancellationRequested) {
    outputChannel?.warn(`[client] @ollama stream returned no output for ${modelId}; retrying with stream=false`);
    const fallback = await (isCloudModel
      ? openAiCompatChatOnce({
          modelId,
          messages: ollamaMessages as Message[],
          shouldThink,
          effectiveClient,
          baseUrl: baseUrl!,
          authToken,
          modelOptions,
          onOpenAiCompatFallback: logOpenAiCompatFallback,
        })
      : nativeSdkChatOnce({
          modelId,
          messages: ollamaMessages as Message[],
          shouldThink,
          effectiveClient,
          modelOptions,
        }));
    if (fallback.message?.content) {
      await writeMarkdown(sanitizeNonStreamingModelOutput(fallback.message.content));
    } else {
      await writeMarkdown('*No response from model. Try rephrasing or switching to a different model.*');
    }
  }

  await endRenderer();
}

/** Select or resolve the model ID for the direct Ollama request. */
async function resolveModelIdForDirectRequest(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
): Promise<string | null> {
  if (request.model.vendor === 'ollama' || request.model.vendor === LANGUAGE_MODEL_VENDOR) {
    return toRuntimeModelId(request.model.id);
  }
  const byokModels = await vscode.lm.selectChatModels({ vendor: 'ollama' });
  if (byokModels.length) {
    return toRuntimeModelId(byokModels[0].id);
  }
  const ourModels = await vscode.lm.selectChatModels({ vendor: LANGUAGE_MODEL_VENDOR });
  if (!ourModels.length) {
    stream.markdown('No Ollama models available. Pull a model first using the Ollama sidebar.');
    return null;
  }
  return toRuntimeModelId(ourModels[0].id);
}

/** Extract cloud authentication and client setup for a model. */
async function setupCloudClientIfNeeded(
  modelId: string,
  client: Ollama,
  extensionContext: vscode.ExtensionContext | undefined,
): Promise<{
  isCloudModel: boolean;
  effectiveClient: Ollama;
  baseUrl: string | undefined;
  authToken: string | undefined;
}> {
  const cloudModelTag = modelId.split(':')[1] ?? '';
  const isCloudModel = cloudModelTag === 'cloud' || cloudModelTag.endsWith('-cloud');
  let effectiveClient = client;
  if (extensionContext) {
    effectiveClient = isCloudModel
      ? await getCloudOllamaClient(extensionContext)
      : await getOllamaClient(extensionContext);
  }
  const baseUrl = isCloudModel ? getOllamaHost() : undefined;
  const authToken = isCloudModel && extensionContext ? await getOllamaAuthToken(extensionContext) : undefined;
  return { isCloudModel, effectiveClient, baseUrl, authToken };
}

async function handleDirectOllamaRequest(
  request: vscode.ChatRequest,
  messages: vscode.LanguageModelChatMessage[],
  context: DirectOllamaRequestContext,
): Promise<void> {
  const { stream, token, client, outputChannel, extensionContext, modelSettings } = context;
  // Direct Ollama path: completely IPC-free, per-token streaming for the @ollama participant.
  const modelId = await resolveModelIdForDirectRequest(request, stream);
  if (!modelId) return;

  const { isCloudModel, effectiveClient, baseUrl, authToken } = await setupCloudClientIfNeeded(
    modelId,
    client,
    extensionContext,
  );

  const logOpenAiCompatFallback = (mode: 'stream' | 'once', failedModelId: string, error: unknown) => {
    const reason = error instanceof Error ? error.message : String(error);
    outputChannel?.warn(
      `[client] OpenAI-compatible ${mode} call failed for ${failedModelId}; falling back to native SDK: ${reason}`,
    );
  };

  // Resolve per-model generation overrides (temperature, top_p, top_k, num_ctx, num_predict, think, think_budget).
  const modelOptions = modelSettings ? getModelOptionsForModel(modelSettings, modelId) : {};

  // Timeout policy: no hard global request timeout is enforced here.
  // Long generations are terminated via cooperative cancellation
  // (`token.isCancellationRequested`) so streaming responses are not cut off
  // unpredictably for slow but healthy models.

  try {
    // Convert VS Code messages to Ollama format and handle context extraction.
    const { ollamaMessages, systemContextParts } = convertMessagesToOllamaFormat(messages);
    const dedupedContextParts = dedupeXmlContextBlocksByTag(systemContextParts);

    // Phase 4: Build location-aware and mode-aware system prompt.
    let systemPrompt = BASE_SYSTEM_PROMPT;

    // Handle location2 for inline chat context
    const location2 = (
      request as unknown as { location2?: { type?: string; document?: { uri: string; languageId: string } } }
    ).location2;
    if (location2) {
      const locationType = location2.type;
      if (locationType === 'inline' || locationType === 'quickChat') {
        systemPrompt += '\n\nProvide concise, focused responses appropriate for quick interactions.';
        // If we have editor context, add file language info
        if (location2.document) {
          systemPrompt += `\n\nYou are editing a ${location2.document.languageId} file.`;
        }
      }
    }

    // Handle modeInstructions2 from custom Copilot modes
    const modeInstructions2 = (request as unknown as { modeInstructions2?: string }).modeInstructions2;
    if (modeInstructions2) {
      systemPrompt += `\n\n${modeInstructions2}`;
    }

    // Handle editedFileEvents for recent workspace context
    const editedFileEvents = (request as unknown as { editedFileEvents?: Array<{ uri: string }> }).editedFileEvents;
    if (editedFileEvents && editedFileEvents.length > 0) {
      const recentFiles = editedFileEvents
        .slice(0, 3)
        .map(e => e.uri.split('/').pop())
        .join(', ');
      systemPrompt += `\n\nRecently edited files: ${recentFiles}`;
    }

    if (dedupedContextParts.length > 0) {
      ollamaMessages.unshift({
        role: 'system',
        content: `${systemPrompt}\n\n${dedupedContextParts.join('\n\n')}`,
      });
    } else {
      ollamaMessages.unshift({ role: 'system', content: systemPrompt });
    }

    // Truncate messages to fit within the model's context window.
    // VS Code injects 100K+ token prompts; small models cannot handle this.
    // resolveContextLimit applies a fallback of 8 192 tokens when no model limit is reported.
    const maxInputTokens = resolveContextLimit(
      request.model.maxInputTokens ?? 0,
      modelOptions.num_ctx,
      getSetting<number>('maxContextTokens', 0),
    );
    if (maxInputTokens > 0) {
      const refs = await resolvePromptReferences(request.references ?? [], outputChannel);
      const truncated = await renderOllamaPrompt(
        ollamaMessages as Message[],
        maxInputTokens,
        text => Math.ceil(text.length / 4),
        refs,
      );
      ollamaMessages.splice(0, ollamaMessages.length, ...truncated);
    }

    // Tool invocation loop — only when VS Code tools and an invocation token are available.
    const vscodeLmTools = vscode.lm.tools ?? [];
    let useXmlFallback = false;
    if (vscodeLmTools.length > 0 && request.toolInvocationToken) {
      const ollamaTools: Tool[] = buildNativeToolsArray(
        vscodeLmTools as unknown as Array<{ name: string; description?: string }>,
      );
      const shouldThinkInToolLoop =
        typeof modelOptions.think === 'boolean' ? modelOptions.think : isThinkingModelId(modelId);

      const toolLoopSuccess = await executeToolCallingLoop({
        isCloudModel,
        modelId,
        ollamaMessages,
        ollamaTools,
        shouldThinkInToolLoop,
        effectiveClient,
        baseUrl,
        authToken,
        modelOptions,
        logOpenAiCompatFallback,
        request,
        stream,
        token,
        outputChannel,
      });

      useXmlFallback = !toolLoopSuccess;
      if (toolLoopSuccess && !useXmlFallback) {
        // Tool loop completed successfully — no need for XML fallback or streaming
        return;
      }
    }

    // Execute XML fallback path if needed.
    if (useXmlFallback && request.toolInvocationToken) {
      const xmlFallbackCompleted = await handleXmlToolFallback({
        modelId,
        isCloudModel,
        ollamaMessages,
        vscodeLmTools,
        request,
        stream,
        token,
        effectiveClient,
        baseUrl,
        authToken,
        modelOptions,
        logOpenAiCompatFallback,
        outputChannel,
      });
      if (xmlFallbackCompleted) {
        return; // XML fallback successfully handled the request
      }
    }

    // Stream response from the model (only if XML fallback wasn't attempted or didn't complete).
    await streamModelResponse({
      modelId,
      isCloudModel,
      ollamaMessages,
      modelOptions,
      shouldThinkInitial: typeof modelOptions.think === 'boolean' ? modelOptions.think : isThinkingModelId(modelId),
      effectiveClient,
      baseUrl,
      authToken,
      stream,
      token,
      outputChannel,
      logOpenAiCompatFallback,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    reportError(outputChannel, 'Chat participant request failed', error, { showToUser: true });
    const isCrashError = error instanceof Error && error.message.includes('model runner has unexpectedly stopped');
    if (isCrashError) {
      // Best-effort unload to keep behaviour consistent with the provider path.
      effectiveClient.generate({ model: modelId, prompt: '', keep_alive: 0, stream: false }).catch(error => {
        outputChannel?.debug(`[client] failed to unload crashed model ${modelId}: ${String(error)}`);
      });
      const selection = await vscode.window.showErrorMessage(
        'The Ollama model runner crashed. Please check the Ollama server logs and restart if needed.',
        'Open Logs',
      );
      if (selection === 'Open Logs') {
        const logsPath = join(homedir(), '.ollama', 'logs', 'server.log');
        try {
          const document = await vscode.workspace.openTextDocument(vscode.Uri.file(logsPath));
          await vscode.window.showTextDocument(document, { preview: false });
        } catch (error) {
          outputChannel?.debug(`[client] failed to open Ollama log file: ${String(error)}`);
          vscode.window
            .showWarningMessage(
              `Could not open Ollama logs at ${logsPath}. Please check that the Ollama server is installed and logging is enabled.`,
            )
            .then(undefined, () => {});
        }
      }
    }
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
      output.info('[server] starting log stream from %LOCALAPPDATA%\\Ollama\\server.log');
      logTailProcess = spawn('powershell', getWindowsLogTailPowerShellArgs(), { stdio: 'pipe' });
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

  await migrateLegacySettingsWithState(context.globalState, diagnostics);

  const client = await getOllamaClient(context);
  const host = getSetting<string>('host', 'http://localhost:11434');
  const autoStartLogStreaming = getSetting<boolean>('streamLogs', true);
  diagnostics.info(`[client] configured host: ${redactDisplayHost(host)}`);
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
          saveModelSettings(context.globalStorageUri, modelSettingsStore, diagnostics).catch(() => {});
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

  const provider = new OllamaChatModelProvider(context, client, diagnostics, () => modelSettingsStore);
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
  (async () => {
    try {
      await handleBuiltInOllamaConflict(undefined, undefined, undefined, undefined, context);
    } catch (error) {
      diagnostics.debug(
        `[client] Built-in Ollama conflict check failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  })().catch(err => diagnostics.debug(`[client] Built-in Ollama conflict IIFE failed: ${String(err)}`));

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
    vscode.commands.registerCommand('opilot.openExtensionSettings', async () => {
      await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:selfagency.opilot');
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
      vscode.window.showInformationMessage('Performance snapshot written to Opilot logs').then(undefined, () => {});
    }),
    vscode.commands.registerCommand('opilot.checkServerHealth', async () => {
      const isConnected = await testConnection(client);
      if (!isConnected) {
        await handleConnectionTestFailure(host, undefined, undefined, logOutputChannel);
      } else {
        vscode.window.showInformationMessage('Ollama server is reachable.').then(undefined, () => {});
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
          saveModelSettings(context.globalStorageUri, modelSettingsStore, diagnostics).catch(() => {});
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
  (async () => {
    try {
      const isConnected = await testConnection(client, 5_000, details => {
        diagnostics.warn(`[client] connection test failed (${details.kind}): ${details.message}`);
      });
      diagnostics.info(`[client] Connection test result: ${isConnected ? 'connected' : 'not connected'}`);
      if (!isConnected) {
        await handleConnectionTestFailure(host, undefined, undefined, logOutputChannel);
      }
    } catch (error) {
      reportError(diagnostics, 'Connection test failed', error, { showToUser: true });
    }
  })().catch(err => diagnostics.debug(`[client] Connection test IIFE failed: ${String(err)}`));

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

  const participant = await setupChatParticipant(context, participantHandler, undefined, client, diagnostics);
  context.subscriptions.push(participant);

  // Phase 6: Create and register chat status item
  const chatStatusItem = createChatStatusItem();
  if (chatStatusItem) {
    context.subscriptions.push({
      dispose: () => disposeChatStatusItem(),
    });
  }

  // Phase 9: Register chat session customization provider for Modelfiles
  const modelfilesFolder =
    (
      await vscode.workspace.workspaceFolders?.[0]?.uri?.with({
        scheme: 'file',
        path: join(homedir(), '.ollama', 'modelfiles'),
      })
    )?.fsPath || join(homedir(), '.ollama', 'modelfiles');

  const chatCustomizationDisposable = registerChatCustomizationProvider({
    modelfilesFolder,
    diagnostics,
  });
  context.subscriptions.push(chatCustomizationDisposable);

  // Phase 10: Set context keys for conditional UI
  const updateContextKeys = async () => {
    try {
      const isOnline = await testConnection(client, 2000);
      await vscode.commands.executeCommand('setContext', 'ollama.serverOnline', isOnline);

      const selectedModel = getSetting<string>('selectedModel', 'llama3.2');
      await vscode.commands.executeCommand('setContext', 'ollama.activeModel', selectedModel);

      const agentModeEnabled = getSetting<boolean>('agentMode', false);
      await vscode.commands.executeCommand('setContext', 'ollama.agentModeEnabled', agentModeEnabled);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      diagnostics.debug(`[context-keys] failed to update context keys: ${msg}`);
    }
  };

  await updateContextKeys();

  // Update context keys when settings change
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('opilot.selectedModel') || event.affectsConfiguration('opilot.agentMode')) {
        updateContextKeys().catch(() => {});
      }
    }),
  );
}

export function deactivate() {
  // Nothing to do; all disposables are registered via context.subscriptions in activate().
}
