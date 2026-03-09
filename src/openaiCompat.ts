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
  fetchFn?: typeof fetch;
  signal?: AbortSignal;
}

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
  } catch {
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

/**
 * Parses Server-Sent Events from an async sequence of text chunks and yields
 * only `data:` payloads. Stops on `[DONE]`.
 */
export async function* parseSseDataPayloadsFromTextChunks(chunks: AsyncIterable<string>): AsyncGenerator<string> {
  let buffer = '';

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

      const lines = rawEvent
        .split(/\r?\n/)
        .map(line => line.trimEnd())
        .filter(Boolean);

      const dataLines = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart());

      if (!dataLines.length) {
        continue;
      }

      const payload = dataLines.join('\n').trim();
      if (!payload) {
        continue;
      }

      if (payload === '[DONE]') {
        return;
      }

      yield payload;
    }
  }

  // Handle a trailing frame without the final separator.
  const trailing = buffer.trim();
  if (!trailing) {
    return;
  }

  const lines = trailing
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(Boolean);

  const dataLines = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart());

  const payload = dataLines.join('\n').trim();
  if (!payload || payload === '[DONE]') {
    return;
  }

  yield payload;
}

export async function* chatCompletionsStream(
  options: OpenAICompatRequestOptions,
): AsyncGenerator<OpenAICompatChatCompletionChunk> {
  const fetchFn = options.fetchFn ?? fetch;
  const url = createOpenAICompatUrl(options.baseUrl);

  const response = await fetchFn(url, {
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
    } catch {
      continue;
    }

    if (parsed && typeof parsed === 'object') {
      yield parsed as OpenAICompatChatCompletionChunk;
    }
  }
}

export async function chatCompletionsOnce(
  options: OpenAICompatRequestOptions,
): Promise<OpenAICompatChatCompletionResponse> {
  const fetchFn = options.fetchFn ?? fetch;
  const url = createOpenAICompatUrl(options.baseUrl);

  const response = await fetchFn(url, {
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
