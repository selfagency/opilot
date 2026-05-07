import * as vscode from 'vscode';

export function reportThinkingProgressSafely(stream: vscode.ChatResponseStream, text: string): boolean {
  const maybe = stream as unknown as { thinkingProgress?: (delta: { text?: string }) => void };
  if (typeof maybe.thinkingProgress !== 'function') {
    return false;
  }
  maybe.thinkingProgress({ text });
  return true;
}

export function reportWarningSafely(stream: vscode.ChatResponseStream, message: string): boolean {
  const maybe = stream as unknown as { warning?: (warning: string) => void };
  if (typeof maybe.warning !== 'function') {
    return false;
  }
  maybe.warning(message);
  return true;
}

export function reportUsageSafely(
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

export function beginToolInvocationSafely(
  stream: vscode.ChatResponseStream,
  toolCallId: string,
  toolName: string,
): boolean {
  const maybe = stream as unknown as {
    beginToolInvocation?: (toolCallId: string, toolName: string) => void;
  };
  if (typeof maybe.beginToolInvocation !== 'function') {
    return false;
  }
  maybe.beginToolInvocation(toolCallId, toolName);
  return true;
}

export function updateToolInvocationSafely(
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
