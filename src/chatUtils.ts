import { cancellationTokenToAbortSignal } from '@agentsy/vscode';
import type { ChatResponse, Message, Ollama, Options, Tool } from 'ollama';
import type { OpenAICompatChatRequest } from './openaiCompat.js';
import { chatCompletionsOnce, initiateChatCompletionsStream } from './openaiCompat.js';
import { ollamaMessagesToOpenAICompat, ollamaToolsToOpenAICompat } from './openaiCompatMapping.js';
import type { ModelOptionOverrides } from './modelSettings.js';

type CompatibleCancellationToken = {
  isCancellationRequested: boolean;
  onCancellationRequested?: (listener: () => void) => { dispose(): void };
};

/** Convert a compatible cancellation token to AbortSignal. */
function tokenToAbortSignal(token?: CompatibleCancellationToken): AbortSignal | undefined {
  if (!token) {
    return undefined;
  }

  try {
    if (typeof token.onCancellationRequested === 'function') {
      return cancellationTokenToAbortSignal(token as Parameters<typeof cancellationTokenToAbortSignal>[0]);
    }
  } catch {
    // Fall back to a basic signal below.
  }

  const controller = new AbortController();
  if (token.isCancellationRequested) {
    controller.abort();
  }
  return controller.signal;
}

function parseToolCallArguments(args: unknown): Record<string, unknown> {
  if (typeof args !== 'string' || !args.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(args);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through to empty object
  }
  return {};
}

function mapSingleToolCall(call: unknown):
  | {
      id?: string;
      function?: { name?: string; arguments?: Record<string, unknown> };
    }
  | undefined {
  if (!call || typeof call !== 'object') {
    return undefined;
  }
  const typed = call as {
    id?: unknown;
    function?: { name?: unknown; arguments?: unknown };
  };
  return {
    id: typeof typed.id === 'string' ? typed.id : undefined,
    function: {
      name: typeof typed.function?.name === 'string' ? typed.function.name : undefined,
      arguments: parseToolCallArguments(typed.function?.arguments),
    },
  };
}

export function mapOpenAiToolCallsToOllamaLike(toolCalls: unknown):
  | Array<{
      id?: string;
      function?: {
        name?: string;
        arguments?: Record<string, unknown>;
      };
    }>
  | undefined {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
    return undefined;
  }

  const mapped = toolCalls.map(mapSingleToolCall).filter(Boolean) as Array<{
    id?: string;
    function?: { name?: string; arguments?: Record<string, unknown> };
  }>;

  return mapped;
}

/**
 * Build an Ollama SDK options object from per-model overrides.
 * Returns undefined when no overrides are set so callers can omit the field entirely.
 */
export function buildSdkOptions(overrides: ModelOptionOverrides): Partial<Options> | undefined {
  const { temperature, top_p, top_k, num_ctx, num_predict, think_budget } = overrides;
  const opts: Record<string, number> = {};
  if (temperature !== undefined) opts['temperature'] = temperature;
  if (top_p !== undefined) opts['top_p'] = top_p;
  if (top_k !== undefined) opts['top_k'] = top_k;
  if (num_ctx !== undefined) opts['num_ctx'] = num_ctx;
  if (num_predict !== undefined) opts['num_predict'] = num_predict;
  // think_budget is not yet in the Ollama SDK's Options type but is forwarded as-is
  if (think_budget !== undefined) opts['think_budget'] = think_budget;
  return Object.keys(opts).length > 0 ? (opts as Partial<Options>) : undefined;
}

function buildOpenAiCompatRequestBody(
  modelId: string,
  messages: Message[],
  tools: Tool[] | undefined,
  shouldThink: boolean,
  modelOptions?: ModelOptionOverrides,
): OpenAICompatChatRequest {
  const { temperature, top_p, num_predict, top_k, num_ctx, think_budget } = modelOptions ?? {};
  return {
    model: modelId,
    messages: ollamaMessagesToOpenAICompat(messages),
    tools: ollamaToolsToOpenAICompat(tools),
    ...(shouldThink ? { think: true } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(top_p !== undefined ? { top_p } : {}),
    ...(num_predict !== undefined ? { max_tokens: num_predict } : {}),
    ...(top_k !== undefined ? { top_k } : {}),
    ...(num_ctx !== undefined ? { num_ctx } : {}),
    ...(think_budget !== undefined ? { think_budget } : {}),
  };
}

async function* streamToChatResponses(
  stream: AsyncIterable<{
    choices?: Array<{
      delta?: { content?: string; reasoning?: string; tool_calls?: unknown };
      finish_reason?: string | null;
    }>;
  }>,
): AsyncGenerator<ChatResponse> {
  for await (const chunk of stream) {
    const choice = chunk.choices?.[0];
    const delta = choice?.delta;
    const content = typeof delta?.content === 'string' ? delta.content : '';
    const thinking = typeof delta?.reasoning === 'string' ? delta.reasoning : undefined;
    const mappedToolCalls = mapOpenAiToolCallsToOllamaLike(delta?.tool_calls);
    yield {
      message: {
        role: 'assistant',
        content,
        ...(thinking ? { thinking } : {}),
        ...(mappedToolCalls ? { tool_calls: mappedToolCalls } : {}),
      },
      done: choice?.finish_reason != null,
    } as ChatResponse;
  }
}

function mapOpenAiResponseToChatResponse(response: {
  choices?: Array<{
    message?: { content?: string | null; reasoning?: string; tool_calls?: unknown };
  }>;
}): ChatResponse {
  const choice = response.choices?.[0];
  const content = typeof choice?.message?.content === 'string' ? choice.message.content : '';
  const thinking = typeof choice?.message?.reasoning === 'string' ? choice.message.reasoning : undefined;
  const mappedToolCalls = mapOpenAiToolCallsToOllamaLike(choice?.message?.tool_calls);
  return {
    message: {
      role: 'assistant',
      content,
      ...(thinking ? { thinking } : {}),
      ...(mappedToolCalls ? { tool_calls: mappedToolCalls } : {}),
    },
    done: true,
  } as ChatResponse;
}

export async function openAiCompatStreamChat(params: {
  modelId: string;
  messages: Message[];
  tools?: Tool[];
  shouldThink: boolean;
  effectiveClient: Ollama;
  baseUrl: string;
  authToken?: string;
  token?: CompatibleCancellationToken;
  signal?: AbortSignal;
  modelOptions?: ModelOptionOverrides;
  onOpenAiCompatFallback?: (mode: 'stream' | 'once', modelId: string, error: unknown) => void;
}): Promise<AsyncIterable<ChatResponse>> {
  try {
    const signal = params.signal || (params.token ? tokenToAbortSignal(params.token) : undefined);
    const stream = await initiateChatCompletionsStream({
      baseUrl: params.baseUrl,
      authToken: params.authToken,
      signal,
      request: buildOpenAiCompatRequestBody(
        params.modelId,
        params.messages,
        params.tools,
        params.shouldThink,
        params.modelOptions,
      ),
    });
    return streamToChatResponses(stream);
  } catch (error) {
    params.onOpenAiCompatFallback?.('stream', params.modelId, error);
    const sdkOptions = params.modelOptions ? buildSdkOptions(params.modelOptions) : undefined;
    return params.effectiveClient.chat({
      model: params.modelId,
      messages: params.messages,
      stream: true,
      ...(params.tools ? { tools: params.tools } : {}),
      ...(params.shouldThink ? { think: true } : {}),
      ...(sdkOptions ? { options: sdkOptions } : {}),
    });
  }
}

export async function openAiCompatChatOnce(params: {
  modelId: string;
  messages: Message[];
  tools?: Tool[];
  shouldThink: boolean;
  effectiveClient: Ollama;
  baseUrl: string;
  authToken?: string;
  token?: CompatibleCancellationToken;
  signal?: AbortSignal;
  modelOptions?: ModelOptionOverrides;
  onOpenAiCompatFallback?: (mode: 'stream' | 'once', modelId: string, error: unknown) => void;
}): Promise<ChatResponse> {
  try {
    const signal = params.signal || (params.token ? tokenToAbortSignal(params.token) : undefined);
    const response = await chatCompletionsOnce({
      baseUrl: params.baseUrl,
      authToken: params.authToken,
      signal,
      request: buildOpenAiCompatRequestBody(
        params.modelId,
        params.messages,
        params.tools,
        params.shouldThink,
        params.modelOptions,
      ),
    });
    return mapOpenAiResponseToChatResponse(response);
  } catch (error) {
    params.onOpenAiCompatFallback?.('once', params.modelId, error);
    const sdkOptions = params.modelOptions ? buildSdkOptions(params.modelOptions) : undefined;
    return (await params.effectiveClient.chat({
      model: params.modelId,
      messages: params.messages,
      stream: false,
      ...(params.tools ? { tools: params.tools } : {}),
      ...(params.shouldThink ? { think: true } : {}),
      ...(sdkOptions ? { options: sdkOptions } : {}),
    })) as ChatResponse;
  }
}

export async function nativeSdkStreamChat(params: {
  modelId: string;
  messages: Message[];
  tools?: Tool[];
  shouldThink: boolean;
  effectiveClient: Ollama;
  modelOptions?: ModelOptionOverrides;
}): Promise<AsyncIterable<ChatResponse>> {
  const sdkOptions = params.modelOptions ? buildSdkOptions(params.modelOptions) : undefined;
  return params.effectiveClient.chat({
    model: params.modelId,
    messages: params.messages,
    stream: true,
    ...(params.tools ? { tools: params.tools } : {}),
    ...(params.shouldThink ? { think: true } : {}),
    ...(sdkOptions ? { options: sdkOptions } : {}),
  });
}

export async function nativeSdkChatOnce(params: {
  modelId: string;
  messages: Message[];
  tools?: Tool[];
  shouldThink: boolean;
  effectiveClient: Ollama;
  modelOptions?: ModelOptionOverrides;
}): Promise<ChatResponse> {
  const sdkOptions = params.modelOptions ? buildSdkOptions(params.modelOptions) : undefined;
  return (await params.effectiveClient.chat({
    model: params.modelId,
    messages: params.messages,
    stream: false,
    ...(params.tools ? { tools: params.tools } : {}),
    ...(params.shouldThink ? { think: true } : {}),
    ...(sdkOptions ? { options: sdkOptions } : {}),
  })) as ChatResponse;
}
