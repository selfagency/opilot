import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Helper: build a minimal vscode mock
// ---------------------------------------------------------------------------

const makeVscodeMock = (host = 'http://localhost:11434', contextLength = 0) => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn((key: string) => {
        if (key === 'host') return host;
        if (key === 'contextLength') return contextLength;
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

    expect(OllamaClass).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'http://myserver:11434' }),
    );
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

    expect(OllamaClass).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'http://localhost:11434' }),
    );
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

    const OllamaClass = vi.fn().mockImplementation(function (
      this: { config: unknown },
      config: unknown,
    ) {
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
    expect(caps.maxOutputTokens).toBe(8192);
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
// getContextLengthOverride
// ---------------------------------------------------------------------------

describe('getContextLengthOverride', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 0 when contextLength is not set', async () => {
    vi.doMock('vscode', () => makeVscodeMock('http://localhost:11434', 0));
    vi.doMock('ollama', () => ({ Ollama: class {} }));

    const { getContextLengthOverride } = await import('./client.js');
    expect(getContextLengthOverride()).toBe(0);
  });

  it('returns the configured value when set', async () => {
    vi.doMock('vscode', () => makeVscodeMock('http://localhost:11434', 8192));
    vi.doMock('ollama', () => ({ Ollama: class {} }));

    const { getContextLengthOverride } = await import('./client.js');
    expect(getContextLengthOverride()).toBe(8192);
  });

  it('returns 0 when contextLength is negative', async () => {
    vi.doMock('vscode', () => makeVscodeMock('http://localhost:11434', -1));
    vi.doMock('ollama', () => ({ Ollama: class {} }));

    const { getContextLengthOverride } = await import('./client.js');
    expect(getContextLengthOverride()).toBe(0);
  });
});
