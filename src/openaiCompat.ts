import { TextDecoder } from 'node:util';

export interface OpenAICompatToolCall {
  id?: string;
  type?: 'function';
  function?: {
    name?: string;
    arguments?: string;
  };
}

export interface OpenAICompatChatCompletionChunk {
  id?: string;
  model?: string;
  choices?: Array<{
    index: number;
    delta?: {
      role?: 'system' | 'user' | 'assistant' | 'tool';
      content?: string;
      reasoning?: string;
      tool_calls?: OpenAICompatToolCall[];
    };
    finish_reason?: string | null;
  }>;
}

export interface OpenAICompatChatCompletionResponse {
  id?: string;
  model?: string;
  choices?: Array<{
    index: number;
    message?: {
      role?: 'system' | 'user' | 'assistant' | 'tool';
      content?: string | null;
      reasoning?: string;
      tool_calls?: OpenAICompatToolCall[];
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export interface OpenAICompatChatRequest {
  model: string;
  messages: unknown[];
  stream?: boolean;
  tools?: unknown[];
  tool_choice?: unknown;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  [key: string]: unknown;
}

export interface OpenAICompatRequestOptions {
  baseUrl: string;
  request: OpenAICompatChatRequest;
  authToken?: string;
  signal?: AbortSignal;
}

type OpenAICompatStreamErrorPayload = {
  error?:
    | string
    | {
        message?: string;
        code?: string | number;
        type?: string;
      };
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

export function createOpenAICompatUrl(baseUrl: string, path = '/v1/chat/completions'): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizeBaseUrl(baseUrl)}${normalizedPath}`;
}

export function buildOpenAICompatHeaders(authToken?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  return headers;
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 4000);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[openai-compat] failed to read error response body: ${message}`);
    return '';
  }
}

async function* toTextChunks(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        const text = decoder.decode(value, { stream: true });
        if (text) {
          yield text;
        }
      }
    }

    const trailing = decoder.decode();
    if (trailing) {
      yield trailing;
    }
  } finally {
    reader.releaseLock();
  }
}

function assertNoMidStreamError(parsed: unknown): void {
  if (!parsed || typeof parsed !== 'object') {
    return;
  }

  const candidate = parsed as OpenAICompatStreamErrorPayload;
  if (!candidate.error) {
    return;
  }

  if (typeof candidate.error === 'string') {
    throw new Error(`OpenAI-compat stream payload error: ${candidate.error}`);
  }

  const parts = [candidate.error.message, candidate.error.type, candidate.error.code]
    .filter(part => part !== undefined && part !== null && String(part).trim() !== '')
    .map(part => String(part).trim());

  throw new Error(`OpenAI-compat stream payload error: ${parts.join(' | ') || 'unknown error'}`);
}

export function extractSseDataLines(rawEvent: string): string[] {
  return rawEvent
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trimStart());
}

export function* processTrailingFrame(trailing: string): Generator<string> {
  if (!trailing) return;
  const dataLines = extractSseDataLines(trailing);
  const payload = dataLines.join('\n').trim();
  if (!payload || payload === '[DONE]') {
    if (dataLines.length === 0) {
      console.warn('[openai-compat] trailing SSE buffer contained no data payload and was discarded');
    }
    return;
  }
  // Guard against oversized SSE events (DoS protection)
  const MAX_SSE_EVENT_SIZE = 1_048_576; // 1 MB
  if (payload.length > MAX_SSE_EVENT_SIZE) {
    throw new Error(`[openai-compat] SSE event exceeds max size (${payload.length} > ${MAX_SSE_EVENT_SIZE})`);
  }
  yield payload;
}

/**
 * Parses Server-Sent Events from an async sequence of text chunks and yields
 * only `data:` payloads. Stops on `[DONE]`.
 * Guards against oversized events (DoS protection).
 */
export async function* parseSseDataPayloadsFromTextChunks(chunks: AsyncIterable<string>): AsyncGenerator<string> {
  let buffer = '';
  const MAX_SSE_EVENT_SIZE = 1_048_576; // 1 MB

  for await (const chunk of chunks) {
    buffer += chunk;

    // Process full event frames separated by blank line.
    while (true) {
      const separatorIndex = buffer.indexOf('\n\n');
      if (separatorIndex === -1) {
        break;
      }

      const rawEvent = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);

      const dataLines = extractSseDataLines(rawEvent);
      const payload = dataLines.join('\n').trim();

      if (!payload) {
        continue;
      }

      // Guard against oversized SSE events (DoS protection)
      if (payload.length > MAX_SSE_EVENT_SIZE) {
        throw new Error(`[openai-compat] SSE event exceeds max size (${payload.length} > ${MAX_SSE_EVENT_SIZE})`);
      }

      if (payload === '[DONE]') {
        return;
      }

      yield payload;
    }
  }

  // Handle a trailing frame without the final separator.
  yield* processTrailingFrame(buffer.trim());
}

export async function* chatCompletionsStream(
  options: OpenAICompatRequestOptions,
): AsyncGenerator<OpenAICompatChatCompletionChunk> {
  const url = createOpenAICompatUrl(options.baseUrl);

  const response = await fetch(url, {
    method: 'POST',
    headers: buildOpenAICompatHeaders(options.authToken),
    body: JSON.stringify({ ...options.request, stream: true }),
    signal: options.signal,
  });

  if (!response.ok) {
    const bodyText = await readErrorBody(response);
    throw new Error(`OpenAI-compat stream request failed (${response.status}): ${bodyText}`.trim());
  }

  if (!response.body) {
    throw new Error('OpenAI-compat stream request failed: response body is empty');
  }

  for await (const payload of parseSseDataPayloadsFromTextChunks(toTextChunks(response.body))) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch (err) {
      // Log JSON parse errors for debugging stream issues. Invalid JSON in SSE streams may indicate
      // an API incompatibility or malformed response. Skip malformed chunks and continue streaming.
      console.warn(
        `[openaiCompat] JSON parse error in stream chunk: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }

    assertNoMidStreamError(parsed);

    if (parsed && typeof parsed === 'object') {
      yield parsed as OpenAICompatChatCompletionChunk;
    }
  }
}

/**
 * Eagerly initiates an OpenAI-compat streaming request and returns a
 * generator that yields parsed SSE chunks. Unlike `chatCompletionsStream`
 * (an `async function*`) the HTTP connection is established before this
 * function resolves, so callers can catch connection/HTTP errors with a
 * normal `try/catch` rather than having to handle them during iteration.
 */
export async function initiateChatCompletionsStream(
  options: OpenAICompatRequestOptions,
): Promise<AsyncGenerator<OpenAICompatChatCompletionChunk>> {
  const url = createOpenAICompatUrl(options.baseUrl);

  const response = await fetch(url, {
    method: 'POST',
    headers: buildOpenAICompatHeaders(options.authToken),
    body: JSON.stringify({ ...options.request, stream: true }),
    signal: options.signal,
  });

  if (!response.ok) {
    const bodyText = await readErrorBody(response);
    throw new Error(`OpenAI-compat stream request failed (${response.status}): ${bodyText}`.trim());
  }

  if (!response.body) {
    throw new Error('OpenAI-compat stream request failed: response body is empty');
  }

  const body = response.body;
  return (async function* (): AsyncGenerator<OpenAICompatChatCompletionChunk> {
    for await (const payload of parseSseDataPayloadsFromTextChunks(toTextChunks(body))) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(payload);
      } catch (err) {
        // Log JSON parse errors for debugging stream issues. Invalid JSON in SSE streams may indicate
        // an API incompatibility or malformed response. Skip malformed chunks and continue streaming.
        console.warn(
          `[openaiCompat] JSON parse error in stream chunk: ${err instanceof Error ? err.message : String(err)}`,
        );
        continue;
      }

      assertNoMidStreamError(parsed);

      if (parsed && typeof parsed === 'object') {
        yield parsed as OpenAICompatChatCompletionChunk;
      }
    }
  })();
}

export async function chatCompletionsOnce(
  options: OpenAICompatRequestOptions,
): Promise<OpenAICompatChatCompletionResponse> {
  const url = createOpenAICompatUrl(options.baseUrl);

  const response = await fetch(url, {
    method: 'POST',
    headers: buildOpenAICompatHeaders(options.authToken),
    body: JSON.stringify({ ...options.request, stream: false }),
    signal: options.signal,
  });

  if (!response.ok) {
    const bodyText = await readErrorBody(response);
    throw new Error(`OpenAI-compat request failed (${response.status}): ${bodyText}`.trim());
  }

  return (await response.json()) as OpenAICompatChatCompletionResponse;
}
