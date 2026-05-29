import type { Message, Tool } from 'ollama';
import { describe, expect, it } from 'vitest';
import { ollamaMessagesToOpenAICompat, ollamaToolsToOpenAICompat } from './openai-compat-mapping.js';

describe('ollamaMessagesToOpenAICompat', () => {
  it('maps text-only messages', () => {
    const messages: Message[] = [
      { role: 'system', content: 'rules' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' }
    ];

    const mapped = ollamaMessagesToOpenAICompat(messages);
    expect(mapped).toEqual([
      { role: 'system', content: 'rules' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' }
    ]);
  });

  it('maps user images to OpenAI image_url content parts', () => {
    const messages: Message[] = [
      {
        role: 'user',
        content: 'describe image',
        images: ['abc123base64']
      }
    ];

    const mapped = ollamaMessagesToOpenAICompat(messages);
    expect(Array.isArray(mapped[0]?.content)).toBe(true);
    const parts = mapped[0]?.content as Array<{
      type: string;
      text?: string;
      image_url?: { url: string };
    }>;
    expect(parts[0]).toEqual({ type: 'text', text: 'describe image' });
    expect(parts[1]?.type).toBe('image_url');
    expect(parts[1]?.image_url?.url).toContain('data:image/png;base64,abc123base64');
  });

  it('maps tool calls with JSON-stringified arguments', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            function: {
              name: 'search',
              arguments: { q: 'hello' }
            }
          }
        ]
      }
    ];

    const mapped = ollamaMessagesToOpenAICompat(messages);
    expect(mapped[0]?.tool_calls?.[0]?.type).toBe('function');
    expect(mapped[0]?.tool_calls?.[0]?.function?.name).toBe('search');
    expect(mapped[0]?.tool_calls?.[0]?.function?.arguments).toBe('{"q":"hello"}');
  });

  it('maps tool role messages and preserves tool_call_id', () => {
    const messages: Message[] = [
      {
        role: 'tool',
        content: 'result payload',
        tool_call_id: 'call-123'
      } as Message
    ];

    const mapped = ollamaMessagesToOpenAICompat(messages);
    expect(mapped).toEqual([
      {
        role: 'tool',
        content: 'result payload',
        tool_call_id: 'call-123'
      }
    ]);
  });

  it('defaults unknown roles to user', () => {
    const messages: Message[] = [
      {
        role: 'unknown-role' as Message['role'],
        content: 'fallback me'
      }
    ];

    const mapped = ollamaMessagesToOpenAICompat(messages);
    expect(mapped[0]?.role).toBe('user');
  });

  it('maps Uint8Array image payloads to base64 data URLs', () => {
    const imageBytes = new Uint8Array([1, 2, 3, 4]);
    const messages: Message[] = [
      {
        role: 'user',
        content: 'inspect this',
        images: [imageBytes]
      }
    ];

    const mapped = ollamaMessagesToOpenAICompat(messages);
    const parts = mapped[0]?.content as Array<{
      type: string;
      image_url?: { url: string };
    }>;
    expect(parts[1]?.type).toBe('image_url');
    expect(parts[1]?.image_url?.url).toContain('data:image/png;base64,');
  });

  it('emits only image part when user text is blank', () => {
    const messages: Message[] = [
      {
        role: 'user',
        content: '   ',
        images: ['abc123base64']
      }
    ];

    const mapped = ollamaMessagesToOpenAICompat(messages);
    const parts = mapped[0]?.content as Array<{ type: string }>;
    expect(parts).toHaveLength(1);
    expect(parts[0]?.type).toBe('image_url');
  });
});

describe('ollamaToolsToOpenAICompat', () => {
  it('maps function tools only', () => {
    const tools: Tool[] = [
      {
        type: 'function',
        function: {
          name: 'search',
          description: 'Search docs',
          parameters: { type: 'object', properties: { q: { type: 'string' } } }
        }
      }
    ];

    const mapped = ollamaToolsToOpenAICompat(tools);
    expect(mapped).toEqual([
      {
        type: 'function',
        function: {
          name: 'search',
          description: 'Search docs',
          parameters: { type: 'object', properties: { q: { type: 'string' } } }
        }
      }
    ]);
  });

  it('returns undefined when tools are missing or empty', () => {
    expect(ollamaToolsToOpenAICompat()).toBeUndefined();
    expect(ollamaToolsToOpenAICompat([])).toBeUndefined();
  });

  it('filters non-function or malformed tools', () => {
    const tools = [
      { type: 'other', function: { name: 'skip' } },
      { type: 'function', function: { description: 'missing name' } },
      {
        type: 'function',
        function: {
          name: 'keep',
          description: 'valid',
          parameters: { type: 'object' }
        }
      }
    ] as unknown as Tool[];

    const mapped = ollamaToolsToOpenAICompat(tools);
    expect(mapped).toEqual([
      {
        type: 'function',
        function: {
          name: 'keep',
          description: 'valid',
          parameters: { type: 'object' }
        }
      }
    ]);
  });
});
