import * as vscode from 'vscode';
import type { DiagnosticsLogger } from '../diagnostics.js';

const LANGUAGE_MODEL_VENDOR = 'selfagency-opilot' as const;
const TASK_COMPLETE_TOOL_NAME = 'task_complete' as const;

/** Extract tool calls and assistant text from the model response stream. */
export async function extractToolCallsAndText(
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
    outputChannel?.warn?.(`[client] LM stream iteration failed: ${message}`);
    throw new Error(`Language model stream interrupted: ${message}`);
  }
  return { pendingToolCalls, assistantTextParts };
}

/** Handle task_complete tool invocation. */
export async function handleTaskCompleteToolInvocation(
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
    outputChannel?.warn?.(`[client] task_complete invocation failed (vscode-lm path): ${message}`);
  }
}

/** Invoke all tool calls and collect results. */
export async function invokeAllTools(
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

export async function runToolRound(
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

/** VS Code LM API path — used when no client is injected. */
export async function handleVsCodeLmRequest(
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
