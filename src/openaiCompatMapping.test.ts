import { describe, expect, it } from 'vitest';
import type { Message, Tool } from 'ollama';
import { ollamaMessagesToOpenAICompat, ollamaToolsToOpenAICompat } from './openaiCompatMapping.js';

describe('ollamaMessagesToOpenAICompat', () => {
  it('maps text-only messages', () => {
    const messages: Message[] = [
      { role: 'system', content: 'rules' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ];

    const mapped = ollamaMessagesToOpenAICompat(messages);
    expect(mapped).toEqual([
      { role: 'system', content: 'rules' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ]);
  });

  it('maps user images to OpenAI image_url content parts', () => {
    const messages: Message[] = [
      {
        role: 'user',
        content: 'describe image',
        images: ['abc123base64'],
      },
    ];

    const mapped = ollamaMessagesToOpenAICompat(messages);
    expect(Array.isArray(mapped[0]?.content)).toBe(true);
    const parts = mapped[0]?.content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
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
              arguments: { q: 'hello' },
            },
          },
        ],
      },
    ];

    const mapped = ollamaMessagesToOpenAICompat(messages);
    expect(mapped[0]?.tool_calls?.[0]?.type).toBe('function');
    expect(mapped[0]?.tool_calls?.[0]?.function?.name).toBe('search');
    expect(mapped[0]?.tool_calls?.[0]?.function?.arguments).toBe('{"q":"hello"}');
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
          parameters: { type: 'object', properties: { q: { type: 'string' } } },
        },
      },
    ];

    const mapped = ollamaToolsToOpenAICompat(tools);
    expect(mapped).toEqual([
      {
        type: 'function',
        function: {
          name: 'search',
          description: 'Search docs',
          parameters: { type: 'object', properties: { q: { type: 'string' } } },
        },
      },
    ]);
  });
});
