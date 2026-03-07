import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promises as fsPromises } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ChatResponse, Message, Ollama, Tool } from 'ollama';
import * as vscode from 'vscode';
import { getCloudOllamaClient, getOllamaClient, testConnection } from './client.js';
import { OllamaInlineCompletionProvider } from './completions.js';
import { createDiagnosticsLogger, getConfiguredLogLevel, type DiagnosticsLogger } from './diagnostics.js';
import { registerModelfileManager } from './modelfiles.js';
import { isThinkingModelId, OllamaChatModelProvider } from './provider.js';
import { registerSidebar } from './sidebar.js';

const LANGUAGE_MODEL_VENDOR = 'selfagency-ollama';
const PROVIDER_MODEL_ID_PREFIX = 'ollama:';
let builtInOllamaConflictPromptInProgress = false;

function toRuntimeModelId(modelId: string): string {
  return modelId.startsWith(PROVIDER_MODEL_ID_PREFIX) ? modelId.slice(PROVIDER_MODEL_ID_PREFIX.length) : modelId;
}

function isSelectedAction(selection: unknown, actionLabel: string): boolean {
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
    diagnostics.info(`[Ollama] Diagnostics log level changed to: ${getConfiguredLogLevel()}`);
    onLogLevelChange?.();
  }

  if (!event.affectsConfiguration('ollama.streamLogs')) {
    return;
  }

  const enabled = vscode.workspace.getConfiguration('ollama').get<boolean>('streamLogs') ?? true;
  diagnostics.info(`[Ollama] Auto-start log streaming setting changed: ${enabled ? 'enabled' : 'disabled'}`);
  onAutoStartChange?.(enabled);
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
  );
  if (selection === 'Open Settings') {
    await commands.executeCommand('workbench.action.openSettings', 'ollama');
  }
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

  const participant = chat.createChatParticipant('ollama-copilot.ollama', participantHandler);
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
    const effectiveClient =
      isCloudModel && extensionContext ? await getCloudOllamaClient(extensionContext) : client;

    try {
      // Convert VS Code messages to the plain Ollama format expected by the client.
      const XML_CONTEXT_TAG_RE = /<([a-zA-Z_][a-zA-Z0-9_.-]*)[^>]*>[\s\S]*?<\/\1>/gi;
      const systemContextParts: string[] = [];

      const ollamaMessages: (Message & { tool_call_id?: string })[] = messages.map(msg => {
        const isUser = msg.role === vscode.LanguageModelChatMessageRole.User;
        let content = (Array.isArray(msg.content) ? msg.content : [])
          .filter((p): p is vscode.LanguageModelTextPart => p instanceof vscode.LanguageModelTextPart)
          .map(p => p.value)
          .join('');
        if (isUser) {
          let remainingText = content;
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

          content = hadLeadingContext ? remainingText : content.trim();
        }
        return {
          role: (isUser ? 'user' : 'assistant') as 'user' | 'assistant',
          content,
        };
      });

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

      // Preserve insertion order (latest occurrence of each tag wins, collected in reverse above)
      const dedupedContextParts = [...latestByTag.values()].reverse();

      if (dedupedContextParts.length > 0) {
        ollamaMessages.unshift({ role: 'system', content: dedupedContextParts.join('\n\n') });
      }

      // Tool invocation loop — only when VS Code tools and an invocation token are available.
      const vscodeLmTools = vscode.lm.tools ?? [];
      if (vscodeLmTools.length > 0 && request.toolInvocationToken) {
        const ollamaTools: Tool[] = vscodeLmTools.map(t => ({
          type: 'function',
          function: {
            name: t.name,
            description: t.description ?? '',
            parameters: t.inputSchema as Tool['function']['parameters'],
          },
        }));

        const MAX_TOOL_ROUNDS = 10;
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          if (token.isCancellationRequested) {
            return;
          }

          const roundResponse = await effectiveClient.chat({
            model: modelId,
            messages: ollamaMessages as Message[],
            stream: false,
            tools: ollamaTools,
          });

          const toolCalls = roundResponse.message.tool_calls;
          if (!toolCalls?.length) {
            // No tool invocations needed — render the response text and exit.
            if (roundResponse.message.content) {
              stream.markdown(roundResponse.message.content);
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
          for (const toolCall of toolCalls) {
            const toolName = toolCall.function.name;
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
        }
        // MAX_TOOL_ROUNDS reached — fall through to the streaming pass below.
      }

      const shouldThinkInitial = isThinkingModelId(modelId);

      let shouldThink = shouldThinkInitial;
      let response: AsyncIterable<ChatResponse>;

      try {
        response = await effectiveClient.chat({
          model: modelId,
          messages: ollamaMessages as Message[],
          stream: true,
          ...(shouldThink ? { think: true } : {}),
        });
      } catch (chatError) {
        if (
          shouldThink &&
          chatError instanceof Error &&
          chatError.name === 'ResponseError' &&
          chatError.message.toLowerCase().includes('does not support thinking')
        ) {
          response = await effectiveClient.chat({
            model: modelId,
            messages: ollamaMessages as Message[],
            stream: true,
          });
        } else {
          throw chatError;
        }
      }

      let thinkingStarted = false;
      let contentStarted = false;

      for await (const chunk of response) {
        if (token.isCancellationRequested) {
          break;
        }

        if (chunk.message?.thinking) {
          if (!thinkingStarted) {
            stream.markdown('\n\n*Thinking*\n\n');
            thinkingStarted = true;
          }
          stream.markdown(chunk.message.thinking);
        }

        if (chunk.message?.content) {
          if (thinkingStarted && !contentStarted) {
            stream.markdown('\n\n---\n\n*Response*\n\n');
            contentStarted = true;
          }
          outputChannel?.debug(`[Ollama] @ollama chunk: ${chunk.message.content.substring(0, 50)}`);
          stream.markdown(chunk.message.content);
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
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      outputChannel?.exception('[Ollama] Chat participant request failed', error);
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

      if (pendingToolCalls.length === 0 || !request.toolInvocationToken) {
        // No more tool calls — stream any buffered text and finish.
        for (const part of assistantTextParts) {
          stream.markdown(part.value);
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
          output.warn(`[Ollama Server] ${line}`);
        } else {
          output.info(`[Ollama Server] ${line}`);
        }
      }
    };

    const platform = process.platform;
    if (platform === 'darwin') {
      const logPath = join(homedir(), '.ollama', 'logs', 'server.log');
      output.info(`[Ollama] Starting log stream from ${logPath}`);
      logTailProcess = spawn('tail', ['-n', '200', '-F', logPath], { stdio: 'pipe' });
    } else if (platform === 'linux') {
      output.info('[Ollama] Starting log stream from journalctl (-u ollama)');
      logTailProcess = spawn('journalctl', ['-u', 'ollama', '--no-pager', '--follow', '--output', 'cat'], {
        stdio: 'pipe',
      });
    } else if (platform === 'win32') {
      const script =
        '$p=Join-Path $env:LOCALAPPDATA \'Ollama\\server.log\'; if (Test-Path $p) { Get-Content -Path $p -Tail 200 -Wait } else { Write-Error "Missing log file: $p" }';
      output.info('[Ollama] Starting log stream from %LOCALAPPDATA%\\Ollama\\server.log');
      logTailProcess = spawn('powershell', ['-NoProfile', '-Command', script], { stdio: 'pipe' });
    } else {
      output.warn(`[Ollama] Log streaming not supported on platform: ${platform}`);
      return;
    }

    logTailProcess.stdout.on('data', chunk => onData(chunk, 'stdout'));
    logTailProcess.stderr.on('data', chunk => onData(chunk, 'stderr'));

    logTailProcess.on('error', error => {
      output.error(`[Ollama] Log stream process failed: ${error.message}`);
      stopLogStreaming();
    });

    logTailProcess.on('exit', (code, signal) => {
      output.info(`[Ollama] Log stream stopped (code=${code ?? 'null'}, signal=${signal ?? 'null'})`);
      logTailProcess = undefined;
    });
  };

  const logOutputChannel =
    typeof vscode.window.createOutputChannel === 'function'
      ? vscode.window.createOutputChannel('Ollama for Copilot', { log: true })
      : undefined;

  const diagnostics = logOutputChannel
    ? createDiagnosticsLogger(logOutputChannel, () => getConfiguredLogLevel())
    : noopLogger;

  diagnostics.info('[Ollama] Activating extension...');

  const client = await getOllamaClient(context);
  const config = vscode.workspace.getConfiguration('ollama');
  const host = config.get<string>('host') || 'http://localhost:11434';
  const autoStartLogStreaming = config.get<boolean>('streamLogs') ?? true;
  diagnostics.info(`[Ollama] Configured host: ${host}`);
  diagnostics.info(`[Ollama] Auto-start log streaming: ${autoStartLogStreaming ? 'enabled' : 'disabled'}`);
  diagnostics.info(`[Ollama] Diagnostics log level: ${getConfiguredLogLevel()}`);

  const provider = new OllamaChatModelProvider(context, client, diagnostics);
  let lmProviderDisposable: vscode.Disposable | undefined;
  try {
    lmProviderDisposable = vscode.lm.registerLanguageModelChatProvider(LANGUAGE_MODEL_VENDOR, provider);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('already registered')) {
      diagnostics.warn(
        `[Ollama] Language model provider vendor "${LANGUAGE_MODEL_VENDOR}" is already registered. Skipping duplicate registration.`,
      );
    } else {
      diagnostics.exception('[Ollama] Language model provider registration failed', error);
      throw error;
    }
  }

  const subscriptions: vscode.Disposable[] = [
    vscode.commands.registerCommand('ollama-copilot.manageAuthToken', async () => {
      await provider.setAuthToken();
    }),
    vscode.commands.registerCommand('ollama-copilot.refreshModels', () => {
      provider.refreshModels();
      diagnostics.info('[Ollama] Model list refresh triggered');
    }),
    {
      dispose: () => stopLogStreaming(),
    },
  ];

  if (lmProviderDisposable) {
    subscriptions.unshift(lmProviderDisposable);
  }

  context.subscriptions.push(...subscriptions);

  // Register sidebar view
  registerSidebar(context, client, diagnostics, () => provider.refreshModels());

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
      diagnostics.info(`[Ollama] Connection test result: ${isConnected ? 'connected' : 'not connected'}`);
      if (!isConnected) {
        await handleConnectionTestFailure(host);
      }
    } catch (error) {
      diagnostics.exception('[Ollama] Connection test failed', error);
    }
  })();

  if (logOutputChannel) {
    diagnostics.info('[Ollama] Activation complete');
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
              diagnostics.info('[Ollama] Log streaming disabled via settings');
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
    await handleChatRequest(request, chatContext, stream, token, client, diagnostics, context);
  };

  const participant = setupChatParticipant(context, participantHandler);
  context.subscriptions.push(participant);
}

export function deactivate() {}
