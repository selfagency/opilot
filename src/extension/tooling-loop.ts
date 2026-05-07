import type { ChatResponse, Message, Ollama, Tool } from 'ollama';
import * as vscode from 'vscode';
import { nativeSdkChatOnce, openAiCompatChatOnce } from '../chatUtils.js';
import type { DiagnosticsLogger } from '../diagnostics.js';
import { sanitizeNonStreamingModelOutput } from '../formatting';
import type { ModelOptionOverrides } from '../modelSettings.js';
import { isToolsNotSupportedError } from '../toolUtils.js';
import { invokeSingleTool } from './tooling-core.js';

export interface ToolLoopContext {
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

/** Execute a single round of tool calling, returning the raw chat response or null on unsupported-tools. */
async function executeToolRound(ctx: ToolLoopContext): Promise<ChatResponse | null> {
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
    outputChannel,
  } = ctx;

  try {
    return await (isCloudModel
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
      outputChannel?.warn?.(`[client] disabling tools for @ollama request on model ${modelId}: ${String(toolError)}`);
      return null;
    }
    throw toolError;
  }
}

/** Process all tool calls in a round and return whether task was completed. */
async function processToolCalls(
  toolCalls: Array<{ function: { name: string; arguments: unknown }; id?: string }>,
  ctx: ToolLoopContext,
): Promise<boolean> {
  const { request, token, outputChannel, ollamaMessages } = ctx;
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

  return taskCompleted;
}

/**
 * Execute the native tool calling loop — handles tool invocation rounds.
 * Returns true if the conversation completed (via task_complete or no more tool calls).
 * Returns false if tools are not supported (triggers XML fallback).
 */
export async function executeToolCallingLoop(ctx: ToolLoopContext): Promise<boolean> {
  const { stream, token } = ctx;
  const MAX_TOOL_ROUNDS = 10;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    if (token.isCancellationRequested) return true;

    const roundResponse = await executeToolRound(ctx);
    if (!roundResponse) {
      return false; // tools not supported → XML fallback
    }

    const toolCalls = roundResponse.message.tool_calls;
    if (!toolCalls?.length) {
      if (roundResponse.message.content) {
        stream.markdown(sanitizeNonStreamingModelOutput(roundResponse.message.content));
      }
      return true; // Conversation complete
    }

    ctx.ollamaMessages.push({
      role: 'assistant',
      content: roundResponse.message.content ?? '',
      tool_calls: toolCalls,
    } as unknown as Message);

    const taskCompleted = await processToolCalls(toolCalls as any, ctx);
    if (taskCompleted) {
      if (roundResponse.message.content) {
        stream.markdown(sanitizeNonStreamingModelOutput(roundResponse.message.content));
      }
      return true; // Agent signaled completion
    }
  }

  return true; // MAX_TOOL_ROUNDS reached
}
