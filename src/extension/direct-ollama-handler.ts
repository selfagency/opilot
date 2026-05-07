/**
 * Direct Ollama request handler
 * Handles streaming requests directly to Ollama models without VS Code LM API overhead
 */

import type { ChatResponse, Message, Ollama } from 'ollama';
import * as vscode from 'vscode';
import { type DiagnosticsLogger } from '../diagnostics.js';
import { type ModelSettingsStore } from '../modelSettings.js';
import { type ChatRequestHandler } from './lm-api.js';

const LANGUAGE_MODEL_VENDOR = 'selfagency-opilot' as const;
const PROVIDER_MODEL_ID_PREFIX = 'ollama:' as const;
const HERMES_MODEL_PATTERN = /qwen2\.5|qwen3|qwq/i;

/**
 * Request context to reduce parameter passing in handleDirectOllamaRequest
 */
export interface DirectOllamaRequestContext {
  stream: vscode.ChatResponseStream;
  token: vscode.CancellationToken;
  client: Ollama;
  outputChannel?: DiagnosticsLogger;
  extensionContext?: vscode.ExtensionContext;
  modelSettings?: ModelSettingsStore;
}

/**
 * Handle a direct request to an Ollama model
 * This path is used when we have a direct Ollama client to avoid VS Code LM API overhead
 */
export async function handleDirectOllamaRequest(
  request: vscode.ChatRequest,
  messages: vscode.LanguageModelChatMessage[],
  context: DirectOllamaRequestContext,
): Promise<void> {
  const {
    stream,
    token,
    client,
    outputChannel,
    extensionContext,
    modelSettings,
  } = context;

  const modelId = request.model.id;
  const isCloudModel = modelId.startsWith('cloud-');
  const effectiveModelId = modelId.startsWith(PROVIDER_MODEL_ID_PREFIX)
    ? modelId.slice(PROVIDER_MODEL_ID_PREFIX.length)
    : modelId;

  const { ollamaMessages, systemContextParts } = convertMessagesToOllamaFormat(messages);
  
  const baseUrl = getOllamaHost(extensionContext);
  const authToken = await getOllamaAuthToken();

  const modelOptions = getModelOptionsForModel(effectiveModelId, modelSettings);

  const logOpenAiCompatFallback = (mode: 'stream' | 'once', modelId: string, error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    outputChannel?.warn?.(
      `[client] OpenAI compat fallback triggered for ${mode} (model=${modelId}): ${message}`,
    );
  };

  const vscodeLmTools = getSelectedLmTools(request);
  const hasTools = vscodeLmTools.length > 0;

  if (hasTools) {
    const toolsSupported = await executeToolCallingLoop({
      modelId: effectiveModelId,
      isCloudModel,
      ollamaMessages,
      vscodeLmTools,
      request,
      stream,
      token,
      effectiveClient: client,
      baseUrl,
      authToken,
      modelOptions,
      logOpenAiCompatFallback,
      outputChannel,
    });

    if (toolsSupported) {
      return;
    }
  }

  await streamModelResponse({
    modelId: effectiveModelId,
    isCloudModel,
    ollamaMessages,
    systemContextParts,
    vscodeLmTools,
    request,
    stream,
    token,
    effectiveClient: client,
    baseUrl,
    authToken,
    modelOptions,
    logOpenAiCompatFallback,
    outputChannel,
  });
}

/**
 * Handle XML tool fallback path for models that don't support native tool calling
 * Returns true if fallback completed successfully
 */
export async function handleXmlToolFallback(options: {
  modelId: string;
  isCloudModel: boolean;
  ollamaMessages: Array<Message | { role: 'tool'; content: string; tool_call_id?: string }>;
  vscodeLmTools: readonly vscode.LanguageModelToolInformation[];
  request: vscode.ChatRequest;
  stream: vscode.ChatResponseStream;
  token: vscode.CancellationToken;
  effectiveClient: Ollama;
  baseUrl: string | undefined;
  authToken: string | undefined;
  modelOptions: ModelOptionOverrides;
  logOpenAiCompatFallback: (mode: 'stream' | 'once', modelId: string, error: unknown) => void;
  outputChannel?: DiagnosticsLogger;
}): Promise<boolean> {
  const {
    modelId,
    isCloudModel,
    ollamaMessages,
    vscodeLmTools,
    request,
    stream,
    token,
    effectiveClient,
    baseUrl,
    authToken,
    modelOptions,
    logOpenAiCompatFallback,
    outputChannel,
  } = options;

  outputChannel?.info(`[client] attempting XML tool call fallback for model ${modelId}`);
  const toolNames = new Set(vscodeLmTools.map(t => t.name));
  const toolCallFormat = HERMES_MODEL_PATTERN.test(modelId) ? 'hermes' : 'xml';
  const xmlSystemPrompt = buildXmlToolSystemPrompt(vscodeLmTools, { format: toolCallFormat });
  const existingSystem = (ollamaMessages as Message[]).filter(m => m.role === 'system');
  const nonSystem = (ollamaMessages as Message[]).filter(m => m.role !== 'system');
  const xmlConversation: Message[] = [...existingSystem, { role: 'system', content: xmlSystemPrompt }, ...nonSystem];

  const MAX_XML_ROUNDS = 5;
  let correctedOnce = false;
  for (let xmlRound = 0; xmlRound < MAX_XML_ROUNDS; xmlRound++) {
    if (token.isCancellationRequested) return true;

    const xmlResponse = await (isCloudModel
      ? openAiCompatChatOnce({
          modelId,
          messages: xmlConversation,
          shouldThink: false,
          effectiveClient: effectiveClient,
          baseUrl: baseUrl!,
          authToken,
          modelOptions,
          onOpenAiCompatFallback: logOpenAiCompatFallback,
        })
      : nativeSdkChatOnce({
          modelId,
          messages: xmlConversation,
          shouldThink: false,
          effectiveClient: effectiveClient,
          modelOptions,
        }));

    const responseText = xmlResponse.message.content ?? '';
    const xmlToolCalls = extractXmlToolCalls(responseText, toolNames);

    if (xmlToolCalls.length === 0) {
      if (!correctedOnce && !responseText.trim() && xmlRound < MAX_XML_ROUNDS - 1) {
        correctedOnce = true;
        xmlConversation.push({ role: 'assistant', content: responseText });
        xmlConversation.push({
          role: 'user',
          content:
            `Your previous response was empty. If you need information, emit a single XML tool call — no markdown fences, no prose. ` +
            `If you already have enough information, answer in plain text. Available tools: ${[...toolNames].join(', ')}.`,
        });
        continue;
      }
      outputChannel?.warn?.(`[client] XML fallback: model ${modelId} did not emit any tool calls after ${MAX_XML_ROUNDS} rounds`);
      return false;
    }

    const toolResults = await beginToolInvocationSafely(xmlToolCalls, request, stream, token, outputChannel);
    if (toolResults === 'aborted' || token.isCancellationRequested) {
      return true;
    }

    const toolOutputs = toolResults.map(r => ({
      role: 'tool' as const,
      content: r.result,
      tool_call_id: r.toolCallId,
    }));

    xmlConversation.push({ role: 'assistant', content: responseText }, ...toolOutputs);

    if (token.isCancellationRequested) {
      return true;
    }
  }

  return false;
}

/**
 * Stream model response to the chat stream
 */
export async function streamModelResponse(options: {
  modelId: string;
  isCloudModel: boolean;
  ollamaMessages: Array<Message | { role: 'tool'; content: string; tool_call_id?: string }>;
  systemContextParts: string[];
  vscodeLmTools: readonly vscode.LanguageModelToolInformation[];
  request: vscode.ChatRequest;
  stream: vscode.ChatResponseStream;
  token: vscode.CancellationToken;
  effectiveClient: Ollama;
  baseUrl: string | undefined;
  authToken: string | undefined;
  modelOptions: ModelOptionOverrides;
  logOpenAiCompatFallback: (mode: 'stream' | 'once', modelId: string, error: unknown) => void;
  outputChannel?: DiagnosticsLogger;
}): Promise<void> {
  const {
    modelId,
    isCloudModel,
    ollamaMessages,
    systemContextParts,
    vscodeLmTools,
    request,
    stream,
    token,
    effectiveClient,
    baseUrl,
    authToken,
    modelOptions,
    logOpenAiCompatFallback,
    outputChannel,
  } = options;

  const modelMessages = ollamaMessages.filter(m => m.role !== 'system') as Message[];
  const systemMessage = systemContextParts.length > 0
    ? systemContextParts.map(part => `Context: ${part}`).join('\n\n')
    : undefined;

  if (systemMessage) {
    modelMessages.unshift({ role: 'system', content: systemMessage });
  }

  const response = await (isCloudModel
    ? openAiCompatStreamChat({
        modelId,
        messages: modelMessages,
        stream: true,
        effectiveClient: effectiveClient,
        baseUrl: baseUrl!,
        authToken,
        modelOptions,
        onOpenAiCompatFallback: (error) => logOpenAiCompatFallback('stream', modelId, error),
      })
    : nativeSdkStreamChat({
        modelId,
        messages: modelMessages,
        stream: true,
        effectiveClient: effectiveClient,
        modelOptions,
      }));

  if (token.isCancellationRequested) {
    return;
  }

  await reportThinkingProgressSafely(response, stream, token, outputChannel);
  await reportUsageSafely(response, stream, token, outputChannel);

  const { pendingToolCalls, assistantTextParts } = await extractToolCallsAndText(
    response,
    stream,
    token,
    outputChannel,
  );

  if (pendingToolCalls.length > 0) {
    await updateToolInvocationSafely(pendingToolCalls, request, stream, token, outputChannel);
    return;
  }

  await reportWarningSafely(assistantTextParts, stream, token, outputChannel);
}

// Re-export types and functions for backward compatibility
import type { ChatRequestHandler } from './lm-api.js';
import type { Ollama } from 'ollama';
import type { ModelOptionOverrides } from '../modelSettings.js';

export type {
  ChatRequestHandler,
  DirectOllamaRequestContext,
  Ollama,
};

// Import utility functions from other modules
import {
  getSelectedLmTools,
  executeToolCallingLoop,
  extractToolCallsAndText,
  reportThinkingProgressSafely,
  reportUsageSafely,
  reportWarningSafely,
  updateToolInvocationSafely,
  beginToolInvocationSafely,
} from './stream-ui.js';

import {
  getModelOptionsForModel,
  getOllamaHost,
  getOllamaAuthToken,
} from '../client.js';

import {
  convertMessagesToOllamaFormat,
  buildXmlToolSystemPrompt,
  extractXmlToolCalls,
  nativeSdkChatOnce,
  nativeSdkStreamChat,
  openAiCompatChatOnce,
  openAiCompatStreamChat,
} from '../chatUtils.js';

import { HERMES_MODEL_PATTERN } from '../contextUtils.js';
