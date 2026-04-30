import { homedir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import type { DiagnosticsLogger } from './diagnostics.js';
import { getConfiguredLogLevel } from './diagnostics.js';
import { affectsSetting, getSetting, SETTINGS_NAMESPACE } from './settings.js';

export function redactDisplayHost(host: string): string {
  try {
    const parsed = new URL(host);
    if (!parsed.username && !parsed.password) {
      return host;
    }

    parsed.username = '';
    parsed.password = '';
    return parsed.toString();
  } catch {
    return host;
  }
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

/**
 * Handle configuration changes for log level and auto-start log streaming.
 */
export function handleConfigurationChange(
  event: vscode.ConfigurationChangeEvent,
  diagnostics: DiagnosticsLogger,
  onLogLevelChange?: () => void,
  onAutoStartChange?: (enabled: boolean) => void,
): void {
  if (affectsSetting(event, 'diagnostics.logLevel')) {
    diagnostics.info(`[client] Diagnostics log level changed to: ${getConfiguredLogLevel()}`);
    onLogLevelChange?.();
  }

  if (!affectsSetting(event, 'streamLogs')) {
    return;
  }

  const enabled = getSetting<boolean>('streamLogs', true);
  diagnostics.info(`[client] Auto-start log streaming setting changed: ${enabled ? 'enabled' : 'disabled'}`);
  onAutoStartChange?.(enabled);
}

export function isLocalHost(host: string): boolean {
  try {
    const { hostname } = new URL(host);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

export async function handleConnectionTestFailure(
  host: string,
  windowApi?: Pick<typeof vscode.window, 'showErrorMessage'> &
    Partial<Pick<typeof vscode.window, 'showInformationMessage' | 'showWarningMessage'>>,
  commandsApi?: Pick<typeof vscode.commands, 'executeCommand'>,
  logOutputChannel?: { show: () => void },
): Promise<void> {
  const window = windowApi || vscode.window;
  const commands = commandsApi || vscode.commands;
  const safeHost = redactDisplayHost(host);

  const selection = await window.showErrorMessage(
    `Cannot connect to Ollama server at ${safeHost}. Please check your ${SETTINGS_NAMESPACE}.host / ollama.host settings and authentication token.`,
    'Open Settings',
    'Open Logs',
  );
  if (selection === 'Open Settings') {
    await commands.executeCommand('workbench.action.openSettings', SETTINGS_NAMESPACE);
    return;
  }

  if (selection === 'Open Logs') {
    if (!isLocalHost(host)) {
      // Remote connection — local Ollama log files won't exist here.
      // Show the extension output channel (which has the connection error) and
      // tell the user where to find the remote server logs.
      logOutputChannel?.show();
      (window.showInformationMessage ?? vscode.window.showInformationMessage)(
        `This is a remote Ollama connection. Check the Ollama server logs on the remote machine at ${safeHost}. Extension connection details are shown in the Opilot output channel.`,
      );
      return;
    }

    const logPath = getOllamaServerLogPath();
    if (!logPath) {
      await (window.showWarningMessage ?? vscode.window.showWarningMessage)(
        'Ollama logs are not available on this platform via file; try journalctl or check Ollama documentation.',
      );
      return;
    }

    try {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(logPath));
      await vscode.window.showTextDocument(document, { preview: false });
    } catch {
      await (window.showWarningMessage ?? vscode.window.showWarningMessage)(
        `Could not open Ollama logs at ${logPath}.`,
      );
    }
  }
}

/**
 * Best-effort local filesystem log path for the Ollama server process.
 * Returns null on platforms where there is no stable file path.
 */
export function getOllamaServerLogPath(): string | null {
  if (process.platform === 'darwin') {
    return join(homedir(), '.ollama', 'logs', 'server.log');
  }

  if (process.platform === 'win32') {
    const localAppData = process.env['LOCALAPPDATA'];
    if (!localAppData) return null;
    return join(localAppData, 'Ollama', 'server.log');
  }

  // Linux: Ollama often runs as a service; logs are usually in journald.
  return null;
}
