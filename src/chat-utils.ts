import type { ChatResponse, Message, Ollama, Options, Tool } from 'ollama';
import type { ModelOptionOverrides, ThinkValue } from './model-settings.js';
import { chatCompletionsOnce, initiateChatCompletionsStream } from './openai-compat.js';
import { ollamaMessagesToOpenAICompat, ollamaToolsToOpenAICompat } from './openai-compat-mapping.js';

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
    return;
  }

  const mapped: Array<{
    id?: string;
    function?: {
      name?: string;
      arguments?: Record<string, unknown>;
    };
  }> = [];

  for (const call of toolCalls) {
    if (!call || typeof call !== 'object') {
      continue;
    }

    const typed = call as {
      id?: unknown;
      function?: {
        name?: unknown;
        arguments?: unknown;
      };
    };

    let parsedArgs: Record<string, unknown> = {};
    if (typeof typed.function?.arguments === 'string' && typed.function.arguments.trim()) {
      try {
        const parsed = JSON.parse(typed.function.arguments);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          parsedArgs = parsed as Record<string, unknown>;
        }
      } catch {
        parsedArgs = {};
      }
    }

    mapped.push({
      id: typeof typed.id === 'string' ? typed.id : undefined,
      function: {
        name: typeof typed.function?.name === 'string' ? typed.function.name : undefined,
        arguments: parsedArgs
      }
    });
  }

  return mapped;
}

/**
 * Build an Ollama SDK options object from per-model overrides.
 * Returns undefined when no overrides are set so callers can omit the field entirely.
 */
export function buildSdkOptions(overrides: ModelOptionOverrides): Partial<Options> | undefined {
  const { temperature, top_p, top_k, num_ctx, num_predict, think_budget, seed, stop } = overrides;
  const opts: Record<string, unknown> = {};
  if (temperature !== undefined) {
    opts.temperature = temperature;
  }
  if (top_p !== undefined) {
    opts.top_p = top_p;
  }
  if (top_k !== undefined) {
    opts.top_k = top_k;
  }
  if (num_ctx !== undefined) {
    opts.num_ctx = num_ctx;
  }
  if (num_predict !== undefined) {
    opts.num_predict = num_predict;
  }
  // think_budget is not yet in the Ollama SDK's Options type but is forwarded as-is
  if (think_budget !== undefined) {
    opts.think_budget = think_budget;
  }
  if (seed !== undefined) {
    opts.seed = seed;
  }
  if (stop !== undefined) {
    opts.stop = stop;
  }
  return Object.keys(opts).length > 0 ? (opts as Partial<Options>) : undefined;
}

function buildOpenAiCompatRequest(params: {
  modelId: string;
  messages: Message[];
  tools?: Tool[];
  think?: ThinkValue;
  modelOptions?: ModelOptionOverrides;
}) {
  const {
    temperature,
    top_p,
    num_predict,
    top_k,
    num_ctx,
    think_budget,
    seed,
    stop,
    frequency_penalty,
    presence_penalty
  } = params.modelOptions ?? {};
  return {
    model: params.modelId,
    messages: ollamaMessagesToOpenAICompat(params.messages),
    tools: ollamaToolsToOpenAICompat(params.tools),
    ...(params.think !== undefined && params.think !== false ? { think: params.think } : {}),
    // Forward reasoning_effort for OpenAI-compat requests using string effort levels
    ...(typeof params.think === 'string' ? { reasoning_effort: params.think } : {}),
    ...(temperature === undefined ? {} : { temperature }),
    ...(top_p === undefined ? {} : { top_p }),
    ...(num_predict === undefined ? {} : { max_tokens: num_predict }),
    ...(top_k === undefined ? {} : { top_k }),
    ...(num_ctx === undefined ? {} : { num_ctx }),
    ...(think_budget === undefined ? {} : { think_budget }),
    ...(seed === undefined ? {} : { seed }),
    ...(stop === undefined ? {} : { stop }),
    ...(frequency_penalty === undefined ? {} : { frequency_penalty }),
    ...(presence_penalty === undefined ? {} : { presence_penalty })
  };
}

export async function openAiCompatStreamChat(params: {
  modelId: string;
  messages: Message[];
  tools?: Tool[];
  think?: ThinkValue;
  effectiveClient: Ollama;
  baseUrl: string;
  authToken?: string;
  signal?: AbortSignal;
  modelOptions?: ModelOptionOverrides;
  onOpenAiCompatFallback?: (mode: 'stream' | 'once', modelId: string, error: unknown) => void;
}): Promise<AsyncIterable<ChatResponse>> {
  try {
    const stream = await initiateChatCompletionsStream({
      baseUrl: params.baseUrl,
      authToken: params.authToken,
      signal: params.signal,
      request: buildOpenAiCompatRequest(params)
    });

    return (async function* (): AsyncGenerator<ChatResponse> {
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
            ...(mappedToolCalls ? { tool_calls: mappedToolCalls } : {})
          },
          done: choice?.finish_reason != null
        } as ChatResponse;
      }
    })();
  } catch (error) {
    params.onOpenAiCompatFallback?.('stream', params.modelId, error);
    const sdkOptions = params.modelOptions ? buildSdkOptions(params.modelOptions) : undefined;
    return params.effectiveClient.chat({
      model: params.modelId,
      messages: params.messages,
      stream: true,
      ...(params.tools ? { tools: params.tools } : {}),
      ...(params.think !== undefined && params.think !== false ? { think: params.think } : {}),
      ...(sdkOptions ? { options: sdkOptions } : {})
    });
  }
}

export async function openAiCompatChatOnce(params: {
  modelId: string;
  messages: Message[];
  tools?: Tool[];
  think?: ThinkValue;
  effectiveClient: Ollama;
  baseUrl: string;
  authToken?: string;
  signal?: AbortSignal;
  modelOptions?: ModelOptionOverrides;
  onOpenAiCompatFallback?: (mode: 'stream' | 'once', modelId: string, error: unknown) => void;
}): Promise<ChatResponse> {
  try {
    const response = await chatCompletionsOnce({
      baseUrl: params.baseUrl,
      authToken: params.authToken,
      signal: params.signal,
      request: buildOpenAiCompatRequest(params)
    });

    const choice = response.choices?.[0];
    const content = typeof choice?.message?.content === 'string' ? choice.message.content : '';
    const thinking = typeof choice?.message?.reasoning === 'string' ? choice.message.reasoning : undefined;
    const mappedToolCalls = mapOpenAiToolCallsToOllamaLike(choice?.message?.tool_calls);

    return {
      message: {
        role: 'assistant',
        content,
        ...(thinking ? { thinking } : {}),
        ...(mappedToolCalls ? { tool_calls: mappedToolCalls } : {})
      },
      done: true
    } as ChatResponse;
  } catch (error) {
    params.onOpenAiCompatFallback?.('once', params.modelId, error);
    const sdkOptions = params.modelOptions ? buildSdkOptions(params.modelOptions) : undefined;
    return (await params.effectiveClient.chat({
      model: params.modelId,
      messages: params.messages,
      stream: false,
      ...(params.tools ? { tools: params.tools } : {}),
      ...(params.think !== undefined && params.think !== false ? { think: params.think } : {}),
      ...(sdkOptions ? { options: sdkOptions } : {})
    })) as ChatResponse;
  }
}

export function nativeSdkStreamChat(params: {
  modelId: string;
  messages: Message[];
  tools?: Tool[];
  think?: ThinkValue;
  effectiveClient: Ollama;
  modelOptions?: ModelOptionOverrides;
}): Promise<AsyncIterable<ChatResponse>> {
  const sdkOptions = params.modelOptions ? buildSdkOptions(params.modelOptions) : undefined;
  return params.effectiveClient.chat({
    model: params.modelId,
    messages: params.messages,
    stream: true,
    ...(params.tools ? { tools: params.tools } : {}),
    ...(params.think !== undefined && params.think !== false ? { think: params.think } : {}),
    ...(sdkOptions ? { options: sdkOptions } : {})
  });
}

export async function nativeSdkChatOnce(params: {
  modelId: string;
  messages: Message[];
  tools?: Tool[];
  think?: ThinkValue;
  effectiveClient: Ollama;
  modelOptions?: ModelOptionOverrides;
}): Promise<ChatResponse> {
  const sdkOptions = params.modelOptions ? buildSdkOptions(params.modelOptions) : undefined;
  return (await params.effectiveClient.chat({
    model: params.modelId,
    messages: params.messages,
    stream: false,
    ...(params.tools ? { tools: params.tools } : {}),
    ...(params.think !== undefined && params.think !== false ? { think: params.think } : {}),
    ...(sdkOptions ? { options: sdkOptions } : {})
  })) as ChatResponse;
}
