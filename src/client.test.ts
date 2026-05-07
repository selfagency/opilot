import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Helper: build a minimal vscode mock
// ---------------------------------------------------------------------------

const makeVscodeMock = (host = 'http://localhost:11434') => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn((key: string) => {
        if (key === 'host') return host;
        return undefined;
      }),
    })),
  },
});

// ---------------------------------------------------------------------------
// getOllamaClient
// ---------------------------------------------------------------------------

describe('getOllamaClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates an Ollama client with the configured host', async () => {
    vi.resetModules();
    vi.doMock('vscode', () => ({
      workspace: {
        getConfiguration: vi.fn(() => ({
          get: vi.fn((key: string) => {
            if (key === 'host') return 'http://myserver:11434';
            return undefined;
          }),
        })),
      },
    }));

    const OllamaClass = vi.fn().mockImplementation(function (this: { host: string }, config: { host: string }) {
      this.host = config.host;
    });
    vi.doMock('ollama', () => ({ Ollama: OllamaClass }));

    const context = {
      secrets: { get: vi.fn().mockResolvedValue(undefined) },
    } as any;

    const { getOllamaClient } = await import('./client.js');
    await getOllamaClient(context);

    expect(OllamaClass).toHaveBeenCalledWith(expect.objectContaining({ host: 'http://myserver:11434' }));
  });

  it('falls back to localhost when host setting is empty', async () => {
    vi.resetModules();
    vi.doMock('vscode', () => ({
      workspace: {
        getConfiguration: vi.fn(() => ({
          get: vi.fn(() => ''),
        })),
      },
    }));

    const OllamaClass = vi.fn().mockImplementation(function (this: { host: string }, config: { host: string }) {
      this.host = config.host;
    });
    vi.doMock('ollama', () => ({ Ollama: OllamaClass }));

    const context = {
      secrets: { get: vi.fn().mockResolvedValue(undefined) },
    } as any;

    const { getOllamaClient } = await import('./client.js');
    await getOllamaClient(context);

    expect(OllamaClass).toHaveBeenCalledWith(expect.objectContaining({ host: 'http://localhost:11434' }));
  });

  it('adds Authorization header when auth token is stored', async () => {
    vi.resetModules();
    vi.doMock('vscode', () => ({
      workspace: {
        getConfiguration: vi.fn(() => ({
          get: vi.fn((key: string) => {
            if (key === 'host') return 'http://localhost:11434';
            return undefined;
          }),
        })),
      },
    }));

    const OllamaClass = vi.fn().mockImplementation(function (this: { config: unknown }, config: unknown) {
      this.config = config;
    });
    vi.doMock('ollama', () => ({ Ollama: OllamaClass }));

    const context = {
      secrets: { get: vi.fn().mockResolvedValue('my-secret-token') },
    } as any;

    const { getOllamaClient } = await import('./client.js');
    await getOllamaClient(context);

    expect(OllamaClass).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: { Authorization: 'Bearer my-secret-token' },
      }),
    );
  });

  it('omits Authorization header when no auth token is stored', async () => {
    vi.resetModules();
    vi.doMock('vscode', () => ({
      workspace: {
        getConfiguration: vi.fn(() => ({
          get: vi.fn((key: string) => {
            if (key === 'host') return 'http://localhost:11434';
            return undefined;
          }),
        })),
      },
    }));

    const OllamaClass = vi.fn().mockImplementation(function (
      this: { config: Record<string, unknown> },
      config: Record<string, unknown>,
    ) {
      this.config = config;
    });
    vi.doMock('ollama', () => ({ Ollama: OllamaClass }));

    const context = {
      secrets: { get: vi.fn().mockResolvedValue(undefined) },
    } as any;

    const { getOllamaClient } = await import('./client.js');
    await getOllamaClient(context);

    const callArg = OllamaClass.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArg?.headers).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// host/auth helper exports
// ---------------------------------------------------------------------------

describe('getOllamaHost / getOllamaAuthToken / getOllamaAuthHeaders / getCloudOllamaClient', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('getOllamaHost reads configured host and falls back to localhost', async () => {
    vi.doMock('vscode', () => makeVscodeMock('http://configured-host:11434'));
    vi.doMock('ollama', () => ({ Ollama: class {} }));

    const { getOllamaHost } = await import('./client.js');
    expect(getOllamaHost()).toBe('http://configured-host:11434');

    vi.resetModules();
    vi.doMock('vscode', () => makeVscodeMock(''));
    vi.doMock('ollama', () => ({ Ollama: class {} }));
    const { getOllamaHost: getHostWithDefault } = await import('./client.js');
    expect(getHostWithDefault()).toBe('http://localhost:11434');
  });

  it('redactUrlCredentials removes URL userinfo but preserves host details', async () => {
    vi.doMock('vscode', () => makeVscodeMock());
    vi.doMock('ollama', () => ({ Ollama: class {} }));

    const { redactUrlCredentials } = await import('./client.js');
    expect(redactUrlCredentials('https://alice:secret@example.com:11434/path')).toBe('https://example.com:11434/path');
    expect(redactUrlCredentials('http://localhost:11434')).toBe('http://localhost:11434');
    expect(redactUrlCredentials('not-a-url')).toBe('not-a-url');
  });

  it('getOllamaAuthToken returns token from secret storage', async () => {
    vi.doMock('vscode', () => makeVscodeMock());
    vi.doMock('ollama', () => ({ Ollama: class {} }));

    const context = {
      secrets: { get: vi.fn().mockResolvedValue('secret-token') },
    } as any;

    const { getOllamaAuthToken } = await import('./client.js');
    await expect(getOllamaAuthToken(context)).resolves.toBe('secret-token');
  });

  it('getOllamaAuthHeaders returns bearer header when token exists', async () => {
    vi.doMock('vscode', () => makeVscodeMock());
    vi.doMock('ollama', () => ({ Ollama: class {} }));

    const context = {
      secrets: { get: vi.fn().mockResolvedValue('secret-token') },
    } as any;

    const { getOllamaAuthHeaders } = await import('./client.js');
    await expect(getOllamaAuthHeaders(context)).resolves.toEqual({
      Authorization: 'Bearer secret-token',
    });
  });

  it('getOllamaAuthHeaders returns undefined when token is missing', async () => {
    vi.doMock('vscode', () => makeVscodeMock());
    vi.doMock('ollama', () => ({ Ollama: class {} }));

    const context = {
      secrets: { get: vi.fn().mockResolvedValue(undefined) },
    } as any;

    const { getOllamaAuthHeaders } = await import('./client.js');
    await expect(getOllamaAuthHeaders(context)).resolves.toBeUndefined();
  });

  it('getCloudOllamaClient reuses getOllamaClient behavior', async () => {
    vi.doMock('vscode', () => makeVscodeMock('http://localhost:11434'));

    const OllamaClass = vi.fn().mockImplementation(function (this: { config: unknown }, config: unknown) {
      this.config = config;
    });
    vi.doMock('ollama', () => ({ Ollama: OllamaClass }));

    const context = {
      secrets: { get: vi.fn().mockResolvedValue('cloud-token') },
    } as any;

    const { getCloudOllamaClient } = await import('./client.js');
    await getCloudOllamaClient(context);

    expect(OllamaClass).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'http://localhost:11434',
        headers: { Authorization: 'Bearer cloud-token' },
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// testConnection
// ---------------------------------------------------------------------------

describe('testConnection', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns true when list() succeeds', async () => {
    vi.doMock('vscode', () => makeVscodeMock());
    vi.doMock('ollama', () => ({ Ollama: class {} }));

    const { testConnection } = await import('./client.js');
    const client = { list: vi.fn().mockResolvedValue({ models: [] }) } as any;

    const result = await testConnection(client);

    expect(result).toBe(true);
  });

  it('returns false when list() throws', async () => {
    vi.doMock('vscode', () => makeVscodeMock());
    vi.doMock('ollama', () => ({ Ollama: class {} }));

    const { testConnection } = await import('./client.js');
    const client = { list: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) } as any;

    const result = await testConnection(client);

    expect(result).toBe(false);
  });

  it('returns false when list() exceeds timeout', async () => {
    vi.doMock('vscode', () => makeVscodeMock());
    vi.doMock('ollama', () => ({ Ollama: class {} }));

    const { testConnection } = await import('./client.js');
    const client = { list: vi.fn().mockImplementation(() => new Promise(() => {})) } as any;

    const result = await testConnection(client, 5);

    expect(result).toBe(false);
  });

  it('reports timeout failure details via callback', async () => {
    vi.doMock('vscode', () => makeVscodeMock());
    vi.doMock('ollama', () => ({ Ollama: class {} }));

    const { testConnection } = await import('./client.js');
    const onFailure = vi.fn();
    const client = { list: vi.fn().mockImplementation(() => new Promise(() => {})) } as any;

    const result = await testConnection(client, 5, onFailure);

    expect(result).toBe(false);
    expect(onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'timeout', message: expect.stringContaining('timed out') }),
    );
  });

  it('returns false when list() is cancelled', async () => {
    vi.doMock('vscode', () => makeVscodeMock());
    vi.doMock('ollama', () => ({ Ollama: class {} }));

    const { testConnection } = await import('./client.js');
    const client = {
      list: vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' })),
    } as any;

    const result = await testConnection(client);

    expect(result).toBe(false);
  });

  it('reports authentication failure details via callback', async () => {
    vi.doMock('vscode', () => makeVscodeMock());
    vi.doMock('ollama', () => ({ Ollama: class {} }));

    const { testConnection } = await import('./client.js');
    const onFailure = vi.fn();
    const authError = Object.assign(new Error('Unauthorized'), { status: 401 });
    const client = { list: vi.fn().mockRejectedValue(authError) } as any;

    const result = await testConnection(client, 5_000, onFailure);

    expect(result).toBe(false);
    expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ kind: 'authentication' }));
  });
});

// ---------------------------------------------------------------------------
// fetchModelCapabilities
// ---------------------------------------------------------------------------

describe('fetchModelCapabilities', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('detects tool calling support from template', async () => {
    vi.doMock('vscode', () => makeVscodeMock());
    vi.doMock('ollama', () => ({ Ollama: class {} }));

    const { fetchModelCapabilities } = await import('./client.js');
    const client = {
      show: vi.fn().mockResolvedValue({
        template: 'Hello {{ .Tools }} world',
        details: { families: [] },
      }),
    } as any;

    const caps = await fetchModelCapabilities(client, 'llama3.2:latest');
    expect(caps.toolCalling).toBe(true);
  });

  it('detects image input from clip family', async () => {
    vi.doMock('vscode', () => makeVscodeMock());
    vi.doMock('ollama', () => ({ Ollama: class {} }));

    const { fetchModelCapabilities } = await import('./client.js');
    const client = {
      show: vi.fn().mockResolvedValue({
        template: 'Hello world',
        details: { families: ['llama', 'clip'] },
      }),
    } as any;

    const caps = await fetchModelCapabilities(client, 'llava:latest');
    expect(caps.imageInput).toBe(true);
  });

  it('detects image input via vision in template', async () => {
    vi.doMock('vscode', () => makeVscodeMock());
    vi.doMock('ollama', () => ({ Ollama: class {} }));

    const { fetchModelCapabilities } = await import('./client.js');
    const client = {
      show: vi.fn().mockResolvedValue({
        template: 'Handle vision input here',
        details: { families: [] },
      }),
    } as any;

    const caps = await fetchModelCapabilities(client, 'llava:latest');
    expect(caps.imageInput).toBe(true);
  });

  it('reads context length from model_info Map with family-specific key', async () => {
    vi.doMock('vscode', () => makeVscodeMock());
    vi.doMock('ollama', () => ({ Ollama: class {} }));

    const { fetchModelCapabilities } = await import('./client.js');
    const modelInfoMap = new Map([['llama.context_length', 8192]]);
    const client = {
      show: vi.fn().mockResolvedValue({
        template: '',
        details: { families: [] },
        model_info: modelInfoMap,
      }),
    } as any;

    const caps = await fetchModelCapabilities(client, 'llama3.2:latest');
    expect(caps.maxInputTokens).toBe(8192);
    expect(caps.maxOutputTokens).toBe(4096);
  });

  it('reads context length from model_info plain object with family-specific key', async () => {
    vi.doMock('vscode', () => makeVscodeMock());
    vi.doMock('ollama', () => ({ Ollama: class {} }));

    const { fetchModelCapabilities } = await import('./client.js');
    const client = {
      show: vi.fn().mockResolvedValue({
        template: '',
        details: { families: [] },
        model_info: { 'qwen2.context_length': 32768 },
      }),
    } as any;

    const caps = await fetchModelCapabilities(client, 'qwen2:latest');
    expect(caps.maxInputTokens).toBe(32768);
  });

  it('reads context length from parameters string as fallback', async () => {
    vi.doMock('vscode', () => makeVscodeMock());
    vi.doMock('ollama', () => ({ Ollama: class {} }));

    const { fetchModelCapabilities } = await import('./client.js');
    const client = {
      show: vi.fn().mockResolvedValue({
        template: '',
        details: { families: [] },
        parameters: 'num_ctx 16384\ntemperature 0.8',
      }),
    } as any;

    const caps = await fetchModelCapabilities(client, 'mistral:latest');
    expect(caps.maxInputTokens).toBe(16384);
  });

  it('returns conservative defaults when show() throws', async () => {
    vi.doMock('vscode', () => makeVscodeMock());
    vi.doMock('ollama', () => ({ Ollama: class {} }));

    const { fetchModelCapabilities } = await import('./client.js');
    const client = {
      show: vi.fn().mockRejectedValue(new Error('Model not found')),
    } as any;

    const caps = await fetchModelCapabilities(client, 'unknown:latest');

    expect(caps.toolCalling).toBe(false);
    expect(caps.imageInput).toBe(false);
    expect(caps.maxInputTokens).toBe(2048);
    expect(caps.maxOutputTokens).toBe(2048);
  });

  it('defaults toolCalling and imageInput to false when template is empty', async () => {
    vi.doMock('vscode', () => makeVscodeMock());
    vi.doMock('ollama', () => ({ Ollama: class {} }));

    const { fetchModelCapabilities } = await import('./client.js');
    const client = {
      show: vi.fn().mockResolvedValue({
        template: '',
        details: { families: [] },
      }),
    } as any;

    const caps = await fetchModelCapabilities(client, 'llama3.2:latest');

    expect(caps.toolCalling).toBe(false);
    expect(caps.imageInput).toBe(false);
  });

  it('uses conservative default context (4096) when no context info found', async () => {
    vi.doMock('vscode', () => makeVscodeMock());
    vi.doMock('ollama', () => ({ Ollama: class {} }));

    const { fetchModelCapabilities } = await import('./client.js');
    const client = {
      show: vi.fn().mockResolvedValue({
        template: '',
        details: { families: [] },
      }),
    } as any;

    const caps = await fetchModelCapabilities(client, 'llama3.2:latest');

    expect(caps.maxInputTokens).toBe(4096);
  });
});

// ---------------------------------------------------------------------------
// findContextLengthInModelInfo
// ---------------------------------------------------------------------------

describe('findContextLengthInModelInfo', () => {
  let findContextLengthInModelInfo: (
    d: Record<string, unknown> | Map<string, unknown> | undefined | null,
  ) => number | undefined;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('vscode', () => makeVscodeMock());
    vi.doMock('ollama', () => ({ Ollama: function MockOllama() {} }));
    ({ findContextLengthInModelInfo } = await import('./client.js'));
  });

  afterEach(() => vi.restoreAllMocks());

  it('should export findContextLengthInModelInfo', () => {
    expect(typeof findContextLengthInModelInfo).toBe('function');
  });

  it('returns value from plain object with exact key context_length', () => {
    expect(findContextLengthInModelInfo({ context_length: 8192 })).toBe(8192);
  });

  it('returns value from plain object with family-prefixed key', () => {
    expect(findContextLengthInModelInfo({ 'llama.context_length': 4096 })).toBe(4096);
  });

  it('returns value from Map with exact key', () => {
    const m = new Map<string, unknown>([['context_length', 16384]]);
    expect(findContextLengthInModelInfo(m)).toBe(16384);
  });

  it('returns value from Map with family-prefixed key', () => {
    const m = new Map<string, unknown>([['qwen2.context_length', 32768]]);
    expect(findContextLengthInModelInfo(m)).toBe(32768);
  });

  it('returns undefined when value is non-positive', () => {
    expect(findContextLengthInModelInfo({ context_length: 0 })).toBeUndefined();
    expect(findContextLengthInModelInfo({ context_length: -1 })).toBeUndefined();
  });

  it('returns undefined when value is not a number', () => {
    expect(findContextLengthInModelInfo({ context_length: 'big' })).toBeUndefined();
  });

  it('returns undefined for null/undefined input', () => {
    expect(findContextLengthInModelInfo(null)).toBeUndefined();
    expect(findContextLengthInModelInfo(undefined)).toBeUndefined();
  });

  it('returns undefined for empty object', () => {
    expect(findContextLengthInModelInfo({})).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// parseContextLength
// ---------------------------------------------------------------------------

describe('parseContextLength', () => {
  let parseContextLength: (modelInfoData: unknown, parameters: unknown) => number;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('vscode', () => makeVscodeMock());
    vi.doMock('ollama', () => ({ Ollama: function MockOllama() {} }));
    ({ parseContextLength } = await import('./client.js'));
  });

  afterEach(() => vi.restoreAllMocks());

  it('should export parseContextLength', () => {
    expect(typeof parseContextLength).toBe('function');
  });

  it('prefers context_length from modelInfoData', () => {
    expect(parseContextLength({ context_length: 8192 }, 'num_ctx 4096')).toBe(8192);
  });

  it('falls back to num_ctx in parameters string', () => {
    expect(parseContextLength(null, 'num_ctx 4096')).toBe(4096);
  });

  it('returns 4096 default when no info and no parameters', () => {
    expect(parseContextLength(null, null)).toBe(4096);
  });

  it('returns 4096 when parameters string has no num_ctx', () => {
    expect(parseContextLength(null, 'temperature 0.7')).toBe(4096);
  });
});

// ---------------------------------------------------------------------------
// parseMaxOutputTokens
// ---------------------------------------------------------------------------

describe('parseMaxOutputTokens', () => {
  let parseMaxOutputTokens: (parameters: unknown, contextLength: number) => number;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('vscode', () => makeVscodeMock());
    vi.doMock('ollama', () => ({ Ollama: function MockOllama() {} }));
    ({ parseMaxOutputTokens } = await import('./client.js'));
  });

  afterEach(() => vi.restoreAllMocks());

  it('should export parseMaxOutputTokens', () => {
    expect(typeof parseMaxOutputTokens).toBe('function');
  });

  it('returns num_predict from parameters string', () => {
    expect(parseMaxOutputTokens('num_predict 2048', 4096)).toBe(2048);
  });

  it('returns contextLength when num_predict is non-positive', () => {
    expect(parseMaxOutputTokens('num_predict -1', 8192)).toBe(8192);
    expect(parseMaxOutputTokens('num_predict 0', 8192)).toBe(8192);
  });

  it('returns 4096 when parameters string has no num_predict', () => {
    expect(parseMaxOutputTokens('temperature 0.7', 8192)).toBe(4096);
  });

  it('returns 4096 when parameters is not a string', () => {
    expect(parseMaxOutputTokens(null, 8192)).toBe(4096);
    expect(parseMaxOutputTokens(undefined, 8192)).toBe(4096);
  });
});
