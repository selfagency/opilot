import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { getOllamaClient, testConnection } from './client.js';
import { OllamaChatModelProvider } from './provider.js';
import { registerSidebar } from './sidebar.js';

export async function activate(context: vscode.ExtensionContext) {
  let logTailProcess: ChildProcessWithoutNullStreams | undefined;

  const stopLogStreaming = () => {
    if (!logTailProcess) {
      return;
    }

    logTailProcess.kill();
    logTailProcess = undefined;
  };

  const startLogStreaming = (output: vscode.LogOutputChannel) => {
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

  logOutputChannel?.show(true);
  logOutputChannel?.info('[Ollama] Activating extension...');

  const client = await getOllamaClient(context);
  const config = vscode.workspace.getConfiguration('ollama');
  const host = config.get<string>('host') || 'http://localhost:11434';
  const autoStartLogStreaming = config.get<boolean>('autoStartLogStreaming') ?? true;
  logOutputChannel?.info(`[Ollama] Configured host: ${host}`);
  logOutputChannel?.info(`[Ollama] Auto-start log streaming: ${autoStartLogStreaming ? 'enabled' : 'disabled'}`);

  const provider = new OllamaChatModelProvider(context, client, logOutputChannel!);
  context.subscriptions.push(
    vscode.lm.registerLanguageModelChatProvider('ollama', provider),
    vscode.commands.registerCommand('ollama-copilot.manageAuthToken', async () => {
      await provider.setAuthToken();
    }),
    {
      dispose: () => stopLogStreaming(),
    },
  );

  // Register sidebar view
  registerSidebar(context, client, logOutputChannel);

  // Test connection to Ollama server on startup (non-blocking)
  void (async () => {
    try {
      const isConnected = await testConnection(client);
      logOutputChannel?.info(`[Ollama] Connection test result: ${isConnected ? 'connected' : 'not connected'}`);
      if (!isConnected) {
        const selection = await vscode.window.showErrorMessage(
          `Cannot connect to Ollama server at ${host}. Please check your ollama.host setting and authentication token.`,
          'Open Settings',
        );
        if (selection === 'Open Settings') {
          await vscode.commands.executeCommand('workbench.action.openSettings', 'ollama');
        }
      }
    } catch (error) {
      if (logOutputChannel) {
        const message = error instanceof Error ? error.message : String(error);
        logOutputChannel.error(`[Ollama] Connection test failed: ${message}`);
      }
    }
  })();

  if (logOutputChannel) {
    logOutputChannel.info('[Ollama] Activation complete');
    if (autoStartLogStreaming) {
      startLogStreaming(logOutputChannel);
    }

    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(event => {
        if (!event.affectsConfiguration('ollama.autoStartLogStreaming')) {
          return;
        }

        const enabled = vscode.workspace.getConfiguration('ollama').get<boolean>('autoStartLogStreaming') ?? true;
        logOutputChannel.info(`[Ollama] Auto-start log streaming setting changed: ${enabled ? 'enabled' : 'disabled'}`);
        if (enabled) {
          startLogStreaming(logOutputChannel);
        } else {
          stopLogStreaming();
          logOutputChannel.info('[Ollama] Log streaming disabled via settings');
        }
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

    try {
      const response = await request.model.sendRequest(messages, {}, token);
      for await (const chunk of response.stream) {
        if (chunk instanceof vscode.LanguageModelTextPart) {
          stream.markdown(chunk.value);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      stream.markdown(`Error: ${message}`);
    }
  };

  const participant = vscode.chat.createChatParticipant('ollama-copilot.ollama', participantHandler);
  participant.iconPath = (vscode.Uri as any).joinPath(context.extensionUri, 'logo.png');
  context.subscriptions.push(participant);
}

export function deactivate() {}
