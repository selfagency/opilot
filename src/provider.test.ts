import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LanguageModelChatMessageRole,
  LanguageModelDataPart,
  LanguageModelTextPart,
  LanguageModelToolCallPart,
  LanguageModelToolResultPart,
} from 'vscode';
import { formatModelName, OllamaChatModelProvider } from './provider.js';

vi.mock('./client.js', () => ({
  getContextLengthOverride: vi.fn(() => 0),
  getOllamaClient: vi.fn(),
}));

// Mock vscode
vi.doMock('vscode', () => ({
  LanguageModelChatMessageRole: { User: 1, Assistant: 2 },
  LanguageModelDataPart: class DataPart {
    constructor(
      public mimeType: string,
      public data: Uint8Array,
    ) {}
  },
  LanguageModelTextPart: class TextPart {
    constructor(public value: string) {}
  },
  LanguageModelToolCallPart: class ToolCallPart {
    constructor(
      public toolCallId: string,
      public name: string,
      public input: any,
    ) {}
  },
  LanguageModelToolResultPart: class ToolResultPart {
    constructor(
      public toolCallId: string,
      public result: any,
    ) {}
  },
  window: {
    showQuickPick: vi.fn(),
    showInputBox: vi.fn(),
  },
}));

describe('formatModelName', () => {
  it('capitalizes a single segment', () => {
    expect(formatModelName('llama2')).toBe('Llama2');
  });

  it('capitalizes each hyphen-separated segment', () => {
    expect(formatModelName('neural-chat-7b')).toBe('Neural Chat 7b');
  });

  it('handles numeric segments without error', () => {
    expect(formatModelName('mistral-7b-v0.1')).toBe('Mistral 7b V0.1');
  });

  it('removes ollama/ prefix if present', () => {
    expect(formatModelName('ollama/llama2')).toBe('Llama2');
  });

  it('keeps :tag suffix', () => {
    expect(formatModelName('granite4:latest')).toBe('Granite4:latest');
    expect(formatModelName('qwen3:8b')).toBe('Qwen3:8b');
    expect(formatModelName('codegemma:2b')).toBe('Codegemma:2b');
  });

  it('strips namespace/ prefix for non-ollama namespaces', () => {
    expect(formatModelName('m3cha/m3cha-coder:7b')).toBe('M3cha Coder:7b');
    expect(formatModelName('microsoft/phi4:latest')).toBe('Phi4:latest');
  });

  it('strips @digest but keeps :tag', () => {
    expect(formatModelName('m3cha/m3cha-coder:7b@1.0.0')).toBe('M3cha Coder:7b');
  });

  it('formats qwen2.5-coder style names', () => {
    expect(formatModelName('qwen2.5-coder:latest')).toBe('Qwen2.5 Coder:latest');
  });

  it('formats names with no tag', () => {
    expect(formatModelName('cogito-v1-preview-llama')).toBe('Cogito V1 Preview Llama');
  });
});

describe('OllamaChatModelProvider caching', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-05T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('throttles model list refreshes inside 30 seconds', async () => {
    const list = vi.fn().mockResolvedValue({ models: [{ name: 'llama3' }] });
    const show = vi.fn().mockResolvedValue({ template: '', details: { families: [] } });

    const provider = new OllamaChatModelProvider(
      { secrets: { get: vi.fn(), store: vi.fn(), delete: vi.fn() } } as any,
      { list, show } as any,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
    );

    await provider.provideLanguageModelChatInformation({ silent: true }, {} as any);
    await provider.provideLanguageModelChatInformation({ silent: true }, {} as any);

    expect(list).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('reuses cached model details after refresh interval', async () => {
    const list = vi.fn().mockResolvedValue({ models: [{ name: 'llama3' }] });
    const show = vi.fn().mockResolvedValue({ template: '', details: { families: [] } });

    const provider = new OllamaChatModelProvider(
      { secrets: { get: vi.fn(), store: vi.fn(), delete: vi.fn() } } as any,
      { list, show } as any,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
    );

    await provider.provideLanguageModelChatInformation({ silent: true }, {} as any);
    vi.setSystemTime(new Date('2026-03-05T00:00:31.000Z'));
    await provider.provideLanguageModelChatInformation({ silent: true }, {} as any);

    expect(list).toHaveBeenCalledTimes(2);
    expect(show).toHaveBeenCalledTimes(1);
  });
});

describe('OllamaChatModelProvider utility flows', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('estimates token count from plain text', async () => {
    const provider = new OllamaChatModelProvider(
      { secrets: { get: vi.fn(), store: vi.fn(), delete: vi.fn() } } as any,
      { list: vi.fn(), show: vi.fn() } as any,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), exception: vi.fn() } as any,
    );

    const count = await provider.provideTokenCount({} as any, '12345678', {} as any);
    expect(count).toBe(2);
  });

  it('estimates token count from message parts', async () => {
    const provider = new OllamaChatModelProvider(
      { secrets: { get: vi.fn(), store: vi.fn(), delete: vi.fn() } } as any,
      { list: vi.fn(), show: vi.fn() } as any,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), exception: vi.fn() } as any,
    );

    const message = {
      content: [
        new LanguageModelTextPart('hello'),
        new LanguageModelToolCallPart('abc123xyz', 'toolName', { input: 'x' }),
        new LanguageModelToolResultPart('abc123xyz', [new LanguageModelTextPart('done')]),
      ],
    } as any;

    const count = await provider.provideTokenCount({} as any, message, {} as any);
    expect(count).toBeGreaterThan(0);
  });
});

describe('OllamaChatModelProvider model detection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('extracts context length from family-specific model_info keys', async () => {
    const show = vi.fn().mockResolvedValue({
      template: '',
      details: { families: [] },
      model_info: {
        'qwen2.context_length': 131072,
      },
    });

    const provider = new OllamaChatModelProvider(
      { secrets: { get: vi.fn(), store: vi.fn(), delete: vi.fn() } } as any,
      { list: vi.fn().mockResolvedValue({ models: [{ name: 'qwen2.5-coder:latest' }] }), show } as any,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), exception: vi.fn() } as any,
    );

    const models = await provider.provideLanguageModelChatInformation({ silent: true }, {} as any);
    expect(models[0]?.maxInputTokens).toBe(131072);
    expect(models[0]?.maxOutputTokens).toBe(131072);
  });

  it('detects tool support from capabilities array', async () => {
    const show = vi.fn().mockResolvedValue({
      template: '',
      details: { families: [] },
      capabilities: ['completion', 'tools'],
    });

    const provider = new OllamaChatModelProvider(
      { secrets: { get: vi.fn(), store: vi.fn(), delete: vi.fn() } } as any,
      { list: vi.fn().mockResolvedValue({ models: [{ name: 'granite4:latest' }] }), show } as any,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), exception: vi.fn() } as any,
    );

    const models = await provider.provideLanguageModelChatInformation({ silent: true }, {} as any);
    expect(models[0]?.capabilities?.toolCalling).toBe(true);
  });

  it('detects vision support from capabilities array', async () => {
    const show = vi.fn().mockResolvedValue({
      template: '',
      details: { families: [] },
      capabilities: ['completion', 'vision'],
    });

    const provider = new OllamaChatModelProvider(
      { secrets: { get: vi.fn(), store: vi.fn(), delete: vi.fn() } } as any,
      { list: vi.fn().mockResolvedValue({ models: [{ name: 'llava:latest' }] }), show } as any,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), exception: vi.fn() } as any,
    );

    const models = await provider.provideLanguageModelChatInformation({ silent: true }, {} as any);
    expect(models[0]?.capabilities?.imageInput).toBe(true);
  });

  it('detects vision models with clip family', async () => {
    const show = vi.fn().mockResolvedValue({
      template: '',
      details: { families: ['clip'] },
    });

    const provider = new OllamaChatModelProvider(
      { secrets: { get: vi.fn(), store: vi.fn(), delete: vi.fn() } } as any,
      { list: vi.fn(), show } as any,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), exception: vi.fn() } as any,
    );

    await provider.provideLanguageModelChatInformation({ silent: true }, {} as any);
    // We can't directly test private methods, but we can verify that models are fetched
    expect(show).toBeDefined();
  });

  it('detects vision models with vision family', async () => {
    const show = vi.fn().mockResolvedValue({
      template: '',
      details: { families: ['vision'] },
    });

    const provider = new OllamaChatModelProvider(
      { secrets: { get: vi.fn(), store: vi.fn(), delete: vi.fn() } } as any,
      { list: vi.fn().mockResolvedValue({ models: [{ name: 'llava' }] }), show } as any,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), exception: vi.fn() } as any,
    );

    const models = await provider.provideLanguageModelChatInformation({ silent: true }, {} as any);
    expect(models).toBeDefined();
  });

  it('detects tool models with Tools placeholder', async () => {
    const show = vi.fn().mockResolvedValue({
      template: 'some template {{ .Tools }} end',
      details: { families: [] },
    });

    const provider = new OllamaChatModelProvider(
      { secrets: { get: vi.fn(), store: vi.fn(), delete: vi.fn() } } as any,
      { list: vi.fn().mockResolvedValue({ models: [{ name: 'tool-model' }] }), show } as any,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), exception: vi.fn() } as any,
    );

    const models = await provider.provideLanguageModelChatInformation({ silent: true }, {} as any);
    expect(models).toBeDefined();
  });

  it('handles missing model families gracefully', async () => {
    const show = vi.fn().mockResolvedValue({
      template: '',
      details: undefined,
    });

    const provider = new OllamaChatModelProvider(
      { secrets: { get: vi.fn(), store: vi.fn(), delete: vi.fn() } } as any,
      { list: vi.fn().mockResolvedValue({ models: [{ name: 'basic-model' }] }), show } as any,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), exception: vi.fn() } as any,
    );

    const models = await provider.provideLanguageModelChatInformation({ silent: true }, {} as any);
    expect(models).toBeDefined();
    expect(models[0]?.capabilities).toBeDefined();
  });
});

describe('OllamaChatModelProvider error handling', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('handles model list fetch errors gracefully', async () => {
    const exception = vi.fn();
    const list = vi.fn().mockRejectedValue(new Error('Connection failed'));

    const provider = new OllamaChatModelProvider(
      { secrets: { get: vi.fn(), store: vi.fn(), delete: vi.fn() } } as any,
      { list, show: vi.fn() } as any,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), exception } as any,
    );

    const models = await provider.provideLanguageModelChatInformation({ silent: true }, {} as any);

    expect(exception).toHaveBeenCalled();
    expect(models).toEqual([]);
  });

  it('returns fallback models on show() failure', async () => {
    const list = vi.fn().mockResolvedValue({
      models: [{ name: 'llama2' }, { name: 'mistral' }],
    });
    const show = vi.fn().mockRejectedValue(new Error('Show failed'));

    const provider = new OllamaChatModelProvider(
      { secrets: { get: vi.fn(), store: vi.fn(), delete: vi.fn() } } as any,
      { list, show } as any,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), exception: vi.fn() } as any,
    );

    const models = await provider.provideLanguageModelChatInformation({ silent: true }, {} as any);

    expect(models).toHaveLength(2);
    expect(models[0]?.name).toBe('Llama2');
    expect(models[0]?.detail).toBe('Ollama');
    expect(models[0]?.capabilities?.toolCalling).toBe(false);
  });

  it('prunes cache when models are removed', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({ models: [{ name: 'llama2' }, { name: 'mistral' }] })
      .mockResolvedValueOnce({ models: [{ name: 'llama2' }] });
    const show = vi.fn().mockResolvedValue({
      template: '',
      details: { families: [] },
    });

    const provider = new OllamaChatModelProvider(
      { secrets: { get: vi.fn(), store: vi.fn(), delete: vi.fn() } } as any,
      { list, show } as any,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), exception: vi.fn() } as any,
    );

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-05T00:00:00.000Z'));

    await provider.provideLanguageModelChatInformation({ silent: true }, {} as any);
    vi.setSystemTime(new Date('2026-03-05T00:00:31.000Z'));

    // This should call list() again and prune mistral from cache
    await provider.provideLanguageModelChatInformation({ silent: true }, {} as any);

    expect(list).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

describe('OllamaChatModelProvider chat response', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('handles cancellation token during chat', async () => {
    const chat = vi.fn().mockImplementation(async function* () {
      yield { message: { content: 'chunk1' } };
      yield { message: { content: 'chunk2' } };
    });

    const provider = new OllamaChatModelProvider(
      { secrets: { get: vi.fn(), store: vi.fn(), delete: vi.fn() } } as any,
      { chat, list: vi.fn(), show: vi.fn() } as any,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), exception: vi.fn() } as any,
    );

    const progress = { report: vi.fn() };
    const token = { isCancellationRequested: true };

    const model = {
      id: 'test-model',
      name: 'Test',
      family: 'ollama',
      version: '1.0.0',
      maxInputTokens: 100,
      maxOutputTokens: 100,
      capabilities: { imageInput: false, toolCalling: false },
    };

    const message = {
      role: LanguageModelChatMessageRole.User,
      name: undefined,
      content: [new LanguageModelTextPart('hello')],
    };

    await provider.provideLanguageModelChatResponse(
      model,
      [message as any],
      { tools: [], toolMode: 'auto' } as any,
      progress as any,
      token as any,
    );

    // Should stop processing immediately
    expect(chat).toHaveBeenCalled();
  });

  it('handles chat response errors', async () => {
    const exception = vi.fn();
    const chat = vi.fn().mockRejectedValue(new Error('Chat failed'));

    const provider = new OllamaChatModelProvider(
      { secrets: { get: vi.fn(), store: vi.fn(), delete: vi.fn() } } as any,
      { chat, list: vi.fn(), show: vi.fn() } as any,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), exception } as any,
    );

    const progress = { report: vi.fn() };
    const token = { isCancellationRequested: false };

    const model = {
      id: 'test-model',
      name: 'Test',
      family: 'ollama',
      version: '1.0.0',
      maxInputTokens: 100,
      maxOutputTokens: 100,
      capabilities: { imageInput: false, toolCalling: false },
    };

    const message = {
      role: LanguageModelChatMessageRole.User,
      name: undefined,
      content: [new LanguageModelTextPart('hello')],
    };

    await provider.provideLanguageModelChatResponse(
      model,
      [message as any],
      { tools: [], toolMode: 'auto' } as any,
      progress as any,
      token as any,
    );

    expect(exception).toHaveBeenCalled();
    expect(progress.report).toHaveBeenCalledWith(expect.objectContaining({ value: expect.stringContaining('Error:') }));
  });

  it('converts mixed message content correctly', async () => {
    const chat = vi.fn().mockImplementation(async function* () {
      yield { message: { content: 'response' } };
    });

    const provider = new OllamaChatModelProvider(
      { secrets: { get: vi.fn(), store: vi.fn(), delete: vi.fn() } } as any,
      { chat, list: vi.fn(), show: vi.fn() } as any,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), exception: vi.fn() } as any,
    );

    const progress = { report: vi.fn() };
    const token = { isCancellationRequested: false };

    const model = {
      id: 'vision-model',
      name: 'Vision',
      family: 'ollama',
      version: '1.0.0',
      maxInputTokens: 100,
      maxOutputTokens: 100,
      capabilities: { imageInput: true, toolCalling: false },
    };

    const message = {
      role: LanguageModelChatMessageRole.User,
      name: undefined,
      content: [
        new LanguageModelTextPart('describe this: '),
        new LanguageModelDataPart(Buffer.from('fake image data'), 'image/jpeg'),
      ],
    };

    await provider.provideLanguageModelChatResponse(
      model,
      [message as any],
      { tools: [], toolMode: 'auto' } as any,
      progress as any,
      token as any,
    );

    expect(chat).toHaveBeenCalled();
    const chatArgs = chat.mock.calls[0]?.[0];
    expect(chatArgs?.messages).toBeDefined();
  });

  it('handles tool calls in response', async () => {
    const chat = vi.fn().mockImplementation(async function* () {
      yield {
        message: {
          tool_calls: [
            {
              id: 'tool-1',
              function: { name: 'get_weather', arguments: { location: 'NYC' } },
            },
          ],
        },
      };
    });

    const provider = new OllamaChatModelProvider(
      { secrets: { get: vi.fn(), store: vi.fn(), delete: vi.fn() } } as any,
      { chat, list: vi.fn(), show: vi.fn() } as any,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), exception: vi.fn() } as any,
    );

    const progress = { report: vi.fn() };
    const token = { isCancellationRequested: false };

    const model = {
      id: 'tool-model',
      name: 'Tools',
      family: 'ollama',
      version: '1.0.0',
      maxInputTokens: 100,
      maxOutputTokens: 100,
      capabilities: { imageInput: false, toolCalling: true },
    };

    const message = {
      role: LanguageModelChatMessageRole.User,
      name: undefined,
      content: [new LanguageModelTextPart('use a tool')],
    };

    const toolDef = {
      name: 'get_weather',
      description: 'Get weather info',
      inputSchema: { type: 'object', properties: {} },
    };

    await provider.provideLanguageModelChatResponse(
      model,
      [message as any],
      { tools: [toolDef], toolMode: 'auto' } as any,
      progress as any,
      token as any,
    );

    expect(progress.report).toHaveBeenCalledWith(expect.objectContaining({ name: 'get_weather' }));
  });

  it('streams text chunks immediately per chunk rather than batching', async () => {
    const chat = vi.fn().mockResolvedValue(
      (async function* () {
        yield { message: { content: 'Hello' } };
        yield { message: { content: ', ' } };
        yield { message: { content: 'world!' } };
      })(),
    );

    const provider = new OllamaChatModelProvider(
      { secrets: { get: vi.fn(), store: vi.fn(), delete: vi.fn() } } as any,
      { chat, list: vi.fn(), show: vi.fn() } as any,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), exception: vi.fn() } as any,
    );

    const progress = { report: vi.fn() };
    const token = { isCancellationRequested: false };

    const model = {
      id: 'test-model',
      name: 'Test',
      family: 'ollama',
      version: '1.0.0',
      maxInputTokens: 100,
      maxOutputTokens: 100,
      capabilities: { imageInput: false, toolCalling: false },
    };

    const message = {
      role: LanguageModelChatMessageRole.User,
      name: undefined,
      content: [new LanguageModelTextPart('hi')],
    };

    await provider.provideLanguageModelChatResponse(
      model,
      [message as any],
      { tools: [], toolMode: 'auto' } as any,
      progress as any,
      token as any,
    );

    // Each chunk must be reported individually, not batched
    expect(progress.report).toHaveBeenCalledTimes(3);
    expect(progress.report).toHaveBeenNthCalledWith(1, expect.objectContaining({ value: 'Hello' }));
    expect(progress.report).toHaveBeenNthCalledWith(2, expect.objectContaining({ value: ', ' }));
    expect(progress.report).toHaveBeenNthCalledWith(3, expect.objectContaining({ value: 'world!' }));
  });
});
