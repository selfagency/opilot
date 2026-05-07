import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from './mocks/node.js';
import {
  buildOpenAICompatHeaders,
  chatCompletionsOnce,
  chatCompletionsStream,
  createOpenAICompatUrl,
  extractSseDataLines,
  initiateChatCompletionsStream,
  parseSseDataPayloadsFromTextChunks,
  processTrailingFrame,
} from './openaiCompat.js';

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) {
    out.push(item);
  }
  return out;
}

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
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

  it('ignores trailing frame that is empty', async () => {
    async function* chunks() {
      yield 'data: {"a":1}\n\n';
      yield '   '; // trailing whitespace only — no meaningful frame
    }

    const payloads = await collect(parseSseDataPayloadsFromTextChunks(chunks()));
    expect(payloads).toEqual(['{"a":1}']);
  });

  it('stops on trailing [DONE] without separator', async () => {
    async function* chunks() {
      yield 'data: {"a":1}\n\n';
      yield 'data: [DONE]'; // no trailing \n\n
    }

    const payloads = await collect(parseSseDataPayloadsFromTextChunks(chunks()));
    expect(payloads).toEqual(['{"a":1}']);
  });

  it('ignores frames that have no data: lines', async () => {
    async function* chunks() {
      yield 'event: ping\n\n'; // no data: line
      yield 'data: {"b":2}\n\n';
      yield 'data: [DONE]\n\n';
    }

    const payloads = await collect(parseSseDataPayloadsFromTextChunks(chunks()));
    expect(payloads).toEqual(['{"b":2}']);
  });

  it('ignores frames where data payload is empty after trimming', async () => {
    async function* chunks() {
      yield 'data:   \n\n'; // data line with only whitespace
      yield 'data: {"c":3}\n\n';
      yield 'data: [DONE]\n\n';
    }

    const payloads = await collect(parseSseDataPayloadsFromTextChunks(chunks()));
    expect(payloads).toEqual(['{"c":3}']);
  });
});

describe('chatCompletionsOnce', () => {
  it('posts with stream=false and returns parsed JSON body', async () => {
    let captured: Request | undefined;
    server.use(
      http.post('http://localhost:11434/v1/chat/completions', async ({ request }) => {
        captured = request.clone();
        return HttpResponse.json({
          id: 'resp-1',
          choices: [{ index: 0, message: { role: 'assistant', content: 'hello' } }],
        });
      }),
    );

    const result = await chatCompletionsOnce({
      baseUrl: 'http://localhost:11434',
      authToken: 'abc',
      request: {
        model: 'llama3.2',
        messages: [{ role: 'user', content: 'hi' }],
      },
    });

    expect(result.choices?.[0]?.message?.content).toBe('hello');
    expect(captured?.url).toBe('http://localhost:11434/v1/chat/completions');
    expect(captured?.method).toBe('POST');
    expect(captured?.headers.get('Content-Type')).toBe('application/json');
    expect(captured?.headers.get('Authorization')).toBe('Bearer abc');
    const body = await captured?.json();
    expect(body).toMatchObject({ model: 'llama3.2', stream: false });
  });

  it('throws with response body when non-OK', async () => {
    server.use(
      http.post('http://localhost:11434/v1/chat/completions', () =>
        HttpResponse.text('server exploded', { status: 500 }),
      ),
    );

    await expect(
      chatCompletionsOnce({
        baseUrl: 'http://localhost:11434',
        request: {
          model: 'llama3.2',
          messages: [{ role: 'user', content: 'hi' }],
        },
      }),
    ).rejects.toThrow('OpenAI-compat request failed (500): server exploded');
  });
});

describe('chatCompletionsStream', () => {
  it('posts with stream=true and yields parsed SSE JSON payloads', async () => {
    let captured: Request | undefined;
    server.use(
      http.post('http://localhost:11434/v1/chat/completions', async ({ request }) => {
        captured = request.clone();
        return new HttpResponse(
          streamFromChunks([
            'data: {"id":"c1","choices":[{"index":0,"delta":{"content":"hello"}}]}\n\n',
            'data: {"id":"c2","choices":[{"index":0,"delta":{"content":" world"}}]}\n\n',
            'data: [DONE]\n\n',
          ]),
          { headers: { 'Content-Type': 'text/event-stream' } },
        );
      }),
    );

    const chunks = await collect(
      chatCompletionsStream({
        baseUrl: 'http://localhost:11434',
        request: {
          model: 'llama3.2',
          messages: [{ role: 'user', content: 'hi' }],
        },
      }),
    );

    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.choices?.[0]?.delta?.content).toBe('hello');
    expect(chunks[1]?.choices?.[0]?.delta?.content).toBe(' world');
    const body = await captured?.json();
    expect(body).toMatchObject({ stream: true });
  });

  it('skips malformed JSON payloads and continues stream', async () => {
    server.use(
      http.post(
        'http://localhost:11434/v1/chat/completions',
        () =>
          new HttpResponse(
            streamFromChunks([
              'data: {not-json}\n\n',
              'data: {"choices":[{"index":0,"delta":{"content":"ok"}}]}\n\n',
              'data: [DONE]\n\n',
            ]),
            { headers: { 'Content-Type': 'text/event-stream' } },
          ),
      ),
    );

    const chunks = await collect(
      chatCompletionsStream({
        baseUrl: 'http://localhost:11434',
        request: {
          model: 'llama3.2',
          messages: [{ role: 'user', content: 'hi' }],
        },
      }),
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.choices?.[0]?.delta?.content).toBe('ok');
  });

  it('throws when stream response is non-OK', async () => {
    server.use(
      http.post('http://localhost:11434/v1/chat/completions', () => HttpResponse.text('bad', { status: 502 })),
    );

    await expect(
      collect(
        chatCompletionsStream({
          baseUrl: 'http://localhost:11434',
          request: {
            model: 'llama3.2',
            messages: [{ role: 'user', content: 'hi' }],
          },
        }),
      ),
    ).rejects.toThrow('OpenAI-compat stream request failed (502): bad');
  });

  it('throws when stream response has no body', async () => {
    server.use(http.post('http://localhost:11434/v1/chat/completions', () => new HttpResponse(null, { status: 200 })));

    await expect(
      collect(
        chatCompletionsStream({
          baseUrl: 'http://localhost:11434',
          request: {
            model: 'llama3.2',
            messages: [{ role: 'user', content: 'hi' }],
          },
        }),
      ),
    ).rejects.toThrow('OpenAI-compat stream request failed: response body is empty');
  });

  it('throws when a mid-stream error payload is received', async () => {
    server.use(
      http.post(
        'http://localhost:11434/v1/chat/completions',
        () =>
          new HttpResponse(
            streamFromChunks([
              'data: {"choices":[{"index":0,"delta":{"content":"partial"}}]}\n\n',
              'data: {"error":{"message":"quota exceeded","code":"rate_limit"}}\n\n',
              'data: [DONE]\n\n',
            ]),
            { headers: { 'Content-Type': 'text/event-stream' } },
          ),
      ),
    );

    await expect(
      collect(
        chatCompletionsStream({
          baseUrl: 'http://localhost:11434',
          request: {
            model: 'llama3.2',
            messages: [{ role: 'user', content: 'hi' }],
          },
        }),
      ),
    ).rejects.toThrow('OpenAI-compat stream payload error: quota exceeded | rate_limit');
  });
});

describe('initiateChatCompletionsStream', () => {
  it('eagerly establishes connection and yields parsed SSE JSON payloads', async () => {
    server.use(
      http.post(
        'http://localhost:11434/v1/chat/completions',
        () =>
          new HttpResponse(
            streamFromChunks([
              'data: {"id":"c1","choices":[{"index":0,"delta":{"content":"hello"}}]}\n\n',
              'data: {"id":"c2","choices":[{"index":0,"delta":{"content":" world"}}]}\n\n',
              'data: [DONE]\n\n',
            ]),
            { headers: { 'Content-Type': 'text/event-stream' } },
          ),
      ),
    );

    const generator = await initiateChatCompletionsStream({
      baseUrl: 'http://localhost:11434',
      request: {
        model: 'llama3.2',
        messages: [{ role: 'user', content: 'hi' }],
      },
    });

    const chunks = await collect(generator);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.choices?.[0]?.delta?.content).toBe('hello');
    expect(chunks[1]?.choices?.[0]?.delta?.content).toBe(' world');
  });

  it('throws synchronously when non-OK response is returned', async () => {
    server.use(
      http.post('http://localhost:11434/v1/chat/completions', () => HttpResponse.text('unauthorized', { status: 401 })),
    );

    await expect(
      initiateChatCompletionsStream({
        baseUrl: 'http://localhost:11434',
        request: {
          model: 'llama3.2',
          messages: [{ role: 'user', content: 'hi' }],
        },
      }),
    ).rejects.toThrow('OpenAI-compat stream request failed (401): unauthorized');
  });

  it('throws synchronously when response body is empty', async () => {
    server.use(http.post('http://localhost:11434/v1/chat/completions', () => new HttpResponse(null, { status: 200 })));

    await expect(
      initiateChatCompletionsStream({
        baseUrl: 'http://localhost:11434',
        request: {
          model: 'llama3.2',
          messages: [{ role: 'user', content: 'hi' }],
        },
      }),
    ).rejects.toThrow('OpenAI-compat stream request failed: response body is empty');
  });

  it('skips malformed JSON payloads and continues stream', async () => {
    server.use(
      http.post(
        'http://localhost:11434/v1/chat/completions',
        () =>
          new HttpResponse(
            streamFromChunks([
              'data: {not-json}\n\n',
              'data: {"choices":[{"index":0,"delta":{"content":"ok"}}]}\n\n',
              'data: [DONE]\n\n',
            ]),
            { headers: { 'Content-Type': 'text/event-stream' } },
          ),
      ),
    );

    const generator = await initiateChatCompletionsStream({
      baseUrl: 'http://localhost:11434',
      request: {
        model: 'llama3.2',
        messages: [{ role: 'user', content: 'hi' }],
      },
    });

    const chunks = await collect(generator);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.choices?.[0]?.delta?.content).toBe('ok');
  });

  it('reads error body when fetch fails and includes it in error message', async () => {
    server.use(
      http.post('http://localhost:11434/v1/chat/completions', () => HttpResponse.text('rate limited', { status: 429 })),
    );

    await expect(
      initiateChatCompletionsStream({
        baseUrl: 'http://localhost:11434',
        request: {
          model: 'llama3.2',
          messages: [{ role: 'user', content: 'hi' }],
        },
      }),
    ).rejects.toThrow('OpenAI-compat stream request failed (429): rate limited');
  });

  it('posts with stream=true in the request body and sends correct headers', async () => {
    let captured: Request | undefined;
    server.use(
      http.post('http://localhost:11434/v1/chat/completions', async ({ request }) => {
        captured = request.clone();
        return new HttpResponse(streamFromChunks(['data: [DONE]\n\n']), {
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }),
    );

    const generator = await initiateChatCompletionsStream({
      baseUrl: 'http://localhost:11434',
      authToken: 'tok',
      request: {
        model: 'llama3.2',
        messages: [{ role: 'user', content: 'hi' }],
      },
    });

    await collect(generator);

    expect(captured?.url).toBe('http://localhost:11434/v1/chat/completions');
    expect(captured?.method).toBe('POST');
    expect(captured?.headers.get('Content-Type')).toBe('application/json');
    expect(captured?.headers.get('Authorization')).toBe('Bearer tok');
    const body = await captured?.json();
    expect(body).toMatchObject({ stream: true });
  });

  it('throws during iteration when a mid-stream error payload is received', async () => {
    server.use(
      http.post(
        'http://localhost:11434/v1/chat/completions',
        () =>
          new HttpResponse(
            streamFromChunks([
              'data: {"choices":[{"index":0,"delta":{"content":"partial"}}]}\n\n',
              'data: {"error":{"message":"upstream failure","type":"server_error"}}\n\n',
              'data: [DONE]\n\n',
            ]),
            { headers: { 'Content-Type': 'text/event-stream' } },
          ),
      ),
    );

    const generator = await initiateChatCompletionsStream({
      baseUrl: 'http://localhost:11434',
      request: {
        model: 'llama3.2',
        messages: [{ role: 'user', content: 'hi' }],
      },
    });

    await expect(collect(generator)).rejects.toThrow(
      'OpenAI-compat stream payload error: upstream failure | server_error',
    );
  });
});

// ---------------------------------------------------------------------------
// extractSseDataLines
// ---------------------------------------------------------------------------

describe('extractSseDataLines', () => {
  it('extracts data lines from a single-event frame', () => {
    expect(extractSseDataLines('data: {"foo":1}')).toEqual(['{"foo":1}']);
  });

  it('strips leading space after data:', () => {
    expect(extractSseDataLines('data:   {"foo":1}')).toEqual(['{"foo":1}']);
  });

  it('ignores non-data lines like event: and id:', () => {
    const frame = 'event: update\nid: 1\ndata: hello';
    expect(extractSseDataLines(frame)).toEqual(['hello']);
  });

  it('handles CRLF line endings', () => {
    expect(extractSseDataLines('data: first\r\ndata: second')).toEqual(['first', 'second']);
  });

  it('returns empty array when no data lines present', () => {
    expect(extractSseDataLines('event: ping\nid: 42')).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(extractSseDataLines('')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// processTrailingFrame
// ---------------------------------------------------------------------------

describe('processTrailingFrame', () => {
  it('yields the payload from a valid trailing data line', () => {
    expect([...processTrailingFrame('data: {"done":true}')]).toEqual(['{"done":true}']);
  });

  it('yields nothing for an empty trailing buffer', () => {
    expect([...processTrailingFrame('')]).toEqual([]);
  });

  it('yields nothing for a [DONE] payload', () => {
    expect([...processTrailingFrame('data: [DONE]')]).toEqual([]);
  });

  it('yields nothing when buffer has no data lines', () => {
    expect([...processTrailingFrame('event: end')]).toEqual([]);
  });
});
