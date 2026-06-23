import type { ChatResponse, Message } from 'ollama';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModelOptionOverrides } from './model-settings.js';

// Mock openai-compat so the integration tests can control its behaviour
vi.mock('./openai-compat.js', () => ({
  initiateChatCompletionsStream: vi.fn(),
  chatCompletionsOnce: vi.fn()
}));

import {
  buildSdkOptions,
  mapOpenAiToolCallsToOllamaLike,
  nativeSdkChatOnce,
  nativeSdkStreamChat,
  openAiCompatChatOnce,
  openAiCompatStreamChat
} from './chat-utils.js';
import type { OpenAICompatChatCompletionChunk, OpenAICompatChatCompletionResponse } from './openai-compat.js';
import * as openaiCompat from './openai-compat.js';

// ─── Pure function tests (no module mocking needed) ───────────────────────

describe('mapOpenAiToolCallsToOllamaLike', () => {
  it('returns undefined for non-array input', () => {
    expect(mapOpenAiToolCallsToOllamaLike(undefined)).toBeUndefined();
    expect(mapOpenAiToolCallsToOllamaLike(null)).toBeUndefined();
    expect(mapOpenAiToolCallsToOllamaLike('hello')).toBeUndefined();
    expect(mapOpenAiToolCallsToOllamaLike(42)).toBeUndefined();
  });

  it('returns undefined for empty array', () => {
    expect(mapOpenAiToolCallsToOllamaLike([])).toBeUndefined();
  });

  it('skips nullish or non-object entries', () => {
    const result = mapOpenAiToolCallsToOllamaLike([null, undefined, 'string', 42]);
    expect(result).toEqual([]);
  });

  it('parses string arguments via JSON.parse', () => {
    const result = mapOpenAiToolCallsToOllamaLike([
      {
        id: 'call_1',
        function: { name: 'get_weather', arguments: '{"location":"NYC"}' }
      }
    ]);
    expect(result).toHaveLength(1);
    expect(result?.[0]).toEqual({
      id: 'call_1',
      function: { name: 'get_weather', arguments: { location: 'NYC' } }
    });
  });

  it('falls back to empty object on JSON parse failure', () => {
    const result = mapOpenAiToolCallsToOllamaLike([{ function: { name: 'bad_json', arguments: '{invalid}' } }]);
    expect(result?.[0].function?.arguments).toEqual({});
  });

  it('handles non-string arguments as empty object', () => {
    const result = mapOpenAiToolCallsToOllamaLike([{ function: { arguments: { already: 'parsed' } } }]);
    expect(result?.[0].function?.arguments).toEqual({});
  });

  it('preserves undefined id and name when missing', () => {
    const result = mapOpenAiToolCallsToOllamaLike([{ function: {} }]);
    expect(result?.[0].id).toBeUndefined();
    expect(result?.[0].function?.name).toBeUndefined();
    expect(result?.[0].function?.arguments).toEqual({});
  });
});

describe('buildSdkOptions', () => {
  it('returns undefined when no overrides are set', () => {
    expect(buildSdkOptions({})).toBeUndefined();
  });

  it('includes only defined properties', () => {
    const opts: ModelOptionOverrides = { temperature: 0.7, top_p: 0.9 };
    expect(buildSdkOptions(opts)).toEqual({ temperature: 0.7, top_p: 0.9 });
  });

  it('includes num_ctx, num_predict, top_k, think_budget', () => {
    const opts: ModelOptionOverrides = { num_ctx: 4096, num_predict: 500, top_k: 40, think_budget: 1000 };
    expect(buildSdkOptions(opts)).toEqual({
      num_ctx: 4096,
      num_predict: 500,
      top_k: 40,
      think_budget: 1000
    });
  });
});

describe('nativeSdkStreamChat', () => {
  it('passes model options when provided', async () => {
    const emptyStream: AsyncGenerator<ChatResponse> = (async function* () {
      await Promise.resolve();
      yield { message: { content: '', role: 'assistant' } } as ChatResponse;
    })();
    const chat = vi.fn().mockResolvedValue(emptyStream);
    const client = { chat } as never;
    await nativeSdkStreamChat({
      modelId: 'test-model',
      messages: [{ role: 'user', content: 'hi' }] as Message[],
      think: true,
      effectiveClient: client,
      modelOptions: { temperature: 0.5, num_ctx: 2048 }
    });
    expect(chat).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'test-model',
        stream: true,
        think: true,
        options: { temperature: 0.5, num_ctx: 2048 }
      })
    );
  });

  it('omits think and options when not specified', async () => {
    const emptyStream: AsyncGenerator<ChatResponse> = (async function* () {
      await Promise.resolve();
      yield { message: { content: '', role: 'assistant' } } as ChatResponse;
    })();
    const chat = vi.fn().mockResolvedValue(emptyStream);
    const client = { chat } as never;
    await nativeSdkStreamChat({
      modelId: 'test-model',
      messages: [{ role: 'user', content: 'hi' }] as Message[],
      think: false,
      effectiveClient: client
    });
    const args = chat.mock.calls[0][0] as Record<string, unknown>;
    expect(args.think).toBeUndefined();
    expect(args.options).toBeUndefined();
  });
});

describe('nativeSdkChatOnce', () => {
  it('passes tools and options when provided', async () => {
    const chat = vi.fn().mockResolvedValue({ message: { content: 'ok' } });
    const client = { chat } as never;
    await nativeSdkChatOnce({
      modelId: 'test-model',
      messages: [{ role: 'user', content: 'hi' }] as Message[],
      think: false,
      effectiveClient: client,
      tools: [{ type: 'function', function: { name: 'foo', description: '', parameters: {} } }],
      modelOptions: { top_k: 20 }
    });
    expect(chat).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'test-model',
        stream: false,
        tools: [{ type: 'function', function: { name: 'foo', description: '', parameters: {} } }],
        options: { top_k: 20 }
      })
    );
    expect(chat.mock.calls[0][0]).not.toHaveProperty('think');
  });
});

// ─── OpenAI-compat path tests (require module mocking) ────────────────────

describe('openAiCompatStreamChat', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('yields formatted chunks on success', async () => {
    const mockStream: AsyncGenerator<OpenAICompatChatCompletionChunk> = (async function* () {
      await Promise.resolve();
      yield { choices: [{ index: 0, delta: { content: 'hello', reasoning: 'thinking...' }, finish_reason: null }] };
      yield { choices: [{ index: 0, delta: { content: ' world' }, finish_reason: 'stop' }] };
    })();
    vi.mocked(openaiCompat.initiateChatCompletionsStream).mockResolvedValue(mockStream);

    const response = await openAiCompatStreamChat({
      modelId: 'test-model',
      messages: [{ role: 'user', content: 'hi' }] as Message[],
      think: true,
      effectiveClient: {} as never,
      baseUrl: 'http://localhost:11434',
      authToken: 'test-token'
    });

    const results: ChatResponse[] = [];
    for await (const chunk of response) {
      results.push(chunk);
    }
    expect(results).toHaveLength(2);
    expect(results[0].message?.content).toBe('hello');
    expect(results[0].message?.thinking).toBe('thinking...');
    expect(results[0].done).toBe(false);
    expect(results[1].done).toBe(true);
  });

  it('falls back to native SDK on fetch failure', async () => {
    const fallbackChat = vi.fn().mockResolvedValue(
      (async function* () {
        await Promise.resolve();
        yield { message: { content: 'fallback' }, done: true };
      })()
    );
    const onFallback = vi.fn();
    vi.mocked(openaiCompat.initiateChatCompletionsStream).mockRejectedValue(new Error('network error'));

    const response = await openAiCompatStreamChat({
      modelId: 'test-model',
      messages: [{ role: 'user', content: 'hi' }] as Message[],
      think: false,
      effectiveClient: { chat: fallbackChat } as never,
      baseUrl: 'http://localhost:11434',
      onOpenAiCompatFallback: onFallback
    });

    for await (const _ of response) {
      /* drain */
    }
    expect(fallbackChat).toHaveBeenCalled();
    expect(onFallback).toHaveBeenCalledWith('stream', 'test-model', expect.any(Error));
  });
});

describe('openAiCompatChatOnce', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns formatted response with thinking and tool calls', async () => {
    vi.mocked(openaiCompat.chatCompletionsOnce).mockResolvedValue({
      choices: [
        {
          index: 0,
          message: {
            content: 'Hello!',
            reasoning: 'thinking content',
            tool_calls: [{ id: 'tc1', function: { name: 'fn1', arguments: '{}' } }]
          }
        }
      ]
    } as OpenAICompatChatCompletionResponse);

    const result = await openAiCompatChatOnce({
      modelId: 'test-model',
      messages: [{ role: 'user', content: 'hi' }] as Message[],
      think: true,
      effectiveClient: {} as never,
      baseUrl: 'http://localhost:11434'
    });

    expect(result.message?.content).toBe('Hello!');
    expect(result.message?.thinking).toBe('thinking content');
    expect(result.message?.tool_calls).toHaveLength(1);
    expect(result.done).toBe(true);
  });

  it('falls back to native SDK on API error', async () => {
    const fallbackChat = vi.fn().mockResolvedValue({ message: { content: 'sdk fallback' } });
    const onFallback = vi.fn();
    vi.mocked(openaiCompat.chatCompletionsOnce).mockRejectedValue(new Error('API error'));

    const result = await openAiCompatChatOnce({
      modelId: 'test-model',
      messages: [{ role: 'user', content: 'hi' }] as Message[],
      think: false,
      effectiveClient: { chat: fallbackChat } as never,
      baseUrl: 'http://localhost:11434',
      onOpenAiCompatFallback: onFallback
    });

    expect(result.message?.content).toBe('sdk fallback');
    expect(onFallback).toHaveBeenCalledWith('once', 'test-model', expect.any(Error));
  });
});
