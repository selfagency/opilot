import * as vscode from 'vscode';
import type { DiagnosticsLogger } from '../diagnostics.js';

/** Validate that tool arguments are a plain object (not null, array, string, etc.) */
export function isValidToolArguments(args: unknown): args is Record<string, unknown> {
  return args !== null && typeof args === 'object' && !Array.isArray(args) && (args as object).constructor === Object;
}

const TASK_COMPLETE_TOOL_NAME = 'task_complete' as const;

/**
 * Invoke a single tool call through the VS Code LM API.
 * Special-cases the task_complete tool as a signal with optional payload.
 */
export async function invokeSingleTool(
  toolCall: { function: { name: string; arguments: unknown }; id?: string },
  request: vscode.ChatRequest,
  token: vscode.CancellationToken,
  outputChannel?: DiagnosticsLogger,
): Promise<{ resultText: string; isTaskComplete: boolean }> {
  const toolName = toolCall.function.name;
  const isTaskComplete = toolName === TASK_COMPLETE_TOOL_NAME;

  if (!isValidToolArguments(toolCall.function.arguments)) {
    const msg = `invalid tool arguments for ${toolName}: expected plain object, got ${typeof toolCall.function.arguments}`;
    outputChannel?.warn?.(`[client] ${msg}`);
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
      outputChannel?.warn?.(`[client] task_complete invocation failed (native path): ${msg}`);
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
