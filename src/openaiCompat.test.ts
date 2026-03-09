import { describe, expect, it } from 'vitest';
import { buildOpenAICompatHeaders, createOpenAICompatUrl, parseSseDataPayloadsFromTextChunks } from './openaiCompat.js';

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) {
    out.push(item);
  }
  return out;
}

describe('createOpenAICompatUrl', () => {
  it('normalizes base URL trailing slash', () => {
    expect(createOpenAICompatUrl('http://localhost:11434/')).toBe('http://localhost:11434/v1/chat/completions');
    expect(createOpenAICompatUrl('http://localhost:11434')).toBe('http://localhost:11434/v1/chat/completions');
  });

  it('supports custom relative path', () => {
    expect(createOpenAICompatUrl('http://localhost:11434/', 'v1/models')).toBe('http://localhost:11434/v1/models');
    expect(createOpenAICompatUrl('http://localhost:11434', '/v1/models')).toBe('http://localhost:11434/v1/models');
  });
});

describe('buildOpenAICompatHeaders', () => {
  it('always includes content-type', () => {
    expect(buildOpenAICompatHeaders()).toEqual({
      'Content-Type': 'application/json',
    });
  });

  it('adds authorization header when token is provided', () => {
    expect(buildOpenAICompatHeaders('abc123')).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer abc123',
    });
  });
});

describe('parseSseDataPayloadsFromTextChunks', () => {
  it('parses normal SSE data frames', async () => {
    async function* chunks() {
      yield 'data: {"a":1}\n\n';
      yield 'data: {"b":2}\n\n';
      yield 'data: [DONE]\n\n';
    }

    const payloads = await collect(parseSseDataPayloadsFromTextChunks(chunks()));
    expect(payloads).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('handles split frames across chunks', async () => {
    async function* chunks() {
      yield 'data: {"a"';
      yield ':1}\n\n';
      yield 'data: [DONE]\n\n';
    }

    const payloads = await collect(parseSseDataPayloadsFromTextChunks(chunks()));
    expect(payloads).toEqual(['{"a":1}']);
  });

  it('ignores non-data lines and keeps only data payload', async () => {
    async function* chunks() {
      yield 'event: message\nid: 1\ndata: {"x":1}\n\n';
      yield 'data: [DONE]\n\n';
    }

    const payloads = await collect(parseSseDataPayloadsFromTextChunks(chunks()));
    expect(payloads).toEqual(['{"x":1}']);
  });

  it('handles trailing frame without final blank-line separator', async () => {
    async function* chunks() {
      yield 'data: {"final":true}';
    }

    const payloads = await collect(parseSseDataPayloadsFromTextChunks(chunks()));
    expect(payloads).toEqual(['{"final":true}']);
  });
});
