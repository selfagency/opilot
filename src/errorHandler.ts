import * as vscode from 'vscode';
import type { DiagnosticsLogger } from './diagnostics.js';

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  return String(error);
}

export function reportError(
  log: DiagnosticsLogger | undefined,
  message: string,
  error: unknown,
  options?: { showToUser?: boolean },
): void {
  const showToUser = options?.showToUser ?? false;
  const formatted = formatError(error);
  try {
    log?.error(`[client] ${message}: ${formatted}`);
  } catch {
    // best-effort logging; swallow to avoid secondary errors
  }

  if (showToUser) {
    try {
      vscode.window
        .showErrorMessage(`${message}: ${error instanceof Error ? error.message : String(error)}`)
        .catch(() => {});
    } catch {
      // ignore UI errors
    }
  }
}

export default reportError;
