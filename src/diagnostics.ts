import * as vscode from 'vscode';

export type DiagnosticsLogLevel = 'debug' | 'info' | 'warn' | 'error';

const levelOrder: Record<DiagnosticsLogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface DiagnosticsLogger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  exception(context: string, error: unknown): void;
}

export function getConfiguredLogLevel(): DiagnosticsLogLevel {
  const value = vscode.workspace.getConfiguration('ollama').get<string>('diagnostics.logLevel');
  if (value === 'debug' || value === 'info' || value === 'warn' || value === 'error') {
    return value;
  }
  return 'info';
}

function shouldLog(currentLevel: DiagnosticsLogLevel, eventLevel: DiagnosticsLogLevel): boolean {
  return levelOrder[eventLevel] >= levelOrder[currentLevel];
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    const stack = error.stack ? `\n${error.stack}` : '';
    return `${error.message}${stack}`;
  }
  return String(error);
}

export function createDiagnosticsLogger(
  output: vscode.LogOutputChannel,
  getLevel: () => DiagnosticsLogLevel,
): DiagnosticsLogger {
  return {
    debug(message: string): void {
      if (shouldLog(getLevel(), 'debug')) {
        output.debug(message);
      }
    },
    info(message: string): void {
      if (shouldLog(getLevel(), 'info')) {
        output.info(message);
      }
    },
    warn(message: string): void {
      if (shouldLog(getLevel(), 'warn')) {
        output.warn(message);
      }
    },
    error(message: string): void {
      if (shouldLog(getLevel(), 'error')) {
        output.error(message);
      }
    },
    exception(context: string, error: unknown): void {
      if (!shouldLog(getLevel(), 'error')) {
        return;
      }
      output.error(`${context}: ${formatError(error)}`);
    },
  };
}
