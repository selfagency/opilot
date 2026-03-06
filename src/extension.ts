import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { getOllamaClient, testConnection } from './client.js';
import { createDiagnosticsLogger, getConfiguredLogLevel, type DiagnosticsLogger } from './diagnostics.js';
import { OllamaChatModelProvider } from './provider.js';
import { registerSidebar } from './sidebar.js';
import { registerModelfileManager } from './modelfiles.js';

const LANGUAGE_MODEL_VENDOR = 'selfagency-ollama';
let builtInOllamaConflictPromptInProgress = false;

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
  participant.iconPath = (vscode.Uri as any).joinPath(context.extensionUri, 'logo.png');
  return participant;
}

/**
 * Detect and offer to disable Copilot's conflicting built-in Ollama provider.
 * Detects via LM models registered under vendor 'ollama'.
 */
export async function handleBuiltInOllamaConflict(
  windowApi?: Pick<typeof vscode.window, 'showWarningMessage' | 'showInformationMessage'>,
  workspaceApi?: Pick<typeof vscode.workspace, 'getConfiguration'>,
  lmApi?: Pick<typeof vscode.lm, 'selectChatModels'>,
  commandsApi?: Pick<typeof vscode.commands, 'executeCommand'>,
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

    if (selection !== 'Disable Built-in Ollama Provider') return;

    // Use empty string to disable the built-in provider explicitly.
    // Using undefined can fall back to a non-empty default and keep it enabled.
    await (ws.getConfiguration('github.copilot.chat') as vscode.WorkspaceConfiguration).update(
      'ollama.url',
      '',
      vscode.ConfigurationTarget.Global,
    );

    const reloadSelection = await win.showInformationMessage(
      "Copilot's built-in Ollama provider has been disabled. Reload VS Code to apply.",
      'Reload Window',
    );

    if (reloadSelection === 'Reload Window') {
      await commands.executeCommand('workbench.action.reloadWindow');
    }
  } finally {
    builtInOllamaConflictPromptInProgress = false;
  }
}

/**
 * Build and send a message to the language model
 */
export async function handleChatRequest(
  request: vscode.ChatRequest,
  chatContext: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
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
    const response = await model.sendRequest(messages, {}, token);
    for await (const chunk of response.stream) {
      if (chunk instanceof vscode.LanguageModelTextPart) {
        stream.markdown(chunk.value);
      }
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
    {
      dispose: () => stopLogStreaming(),
    },
  ];

  if (lmProviderDisposable) {
    subscriptions.unshift(lmProviderDisposable);
  }

  context.subscriptions.push(...subscriptions);

  // Register sidebar view
  registerSidebar(context, client, diagnostics);

  // Register modelfile manager
  registerModelfileManager(context, client, diagnostics);

  // Detect and offer to disable Copilot's built-in Ollama provider (non-blocking)
  void handleBuiltInOllamaConflict();
  const conflictCheckDelaysMs = [1_500, 5_000, 10_000];
  const conflictCheckTimers = conflictCheckDelaysMs.map(delay =>
    setTimeout(() => {
      void handleBuiltInOllamaConflict();
    }, delay),
  );
  context.subscriptions.push({
    dispose: () => {
      for (const timer of conflictCheckTimers) {
        clearTimeout(timer);
      }
    },
  });

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
    await handleChatRequest(request, chatContext, stream, token);
  };

  const participant = setupChatParticipant(context, participantHandler);
  context.subscriptions.push(participant);
}

export function deactivate() {}
