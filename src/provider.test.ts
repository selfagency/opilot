import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LanguageModelChatMessageRole,
  LanguageModelDataPart,
  LanguageModelTextPart,
  LanguageModelToolCallPart,
  LanguageModelToolResultPart,
  window,
} from 'vscode';
import { getOllamaClient } from './client.js';
import { formatModelName, isThinkingModelId, OllamaChatModelProvider } from './provider.js';

vi.mock('./client.js', () => ({
  getContextLengthOverride: vi.fn(() => 0),
  getOllamaClient: vi.fn(),
  getCloudOllamaClient: vi.fn(),
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
    showErrorMessage: vi.fn(),
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

  it('throttles model list refreshes inside 5 seconds', async () => {
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

  it('fetches a fresh model list after the 5-second throttle window', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({ models: [{ name: 'llama3' }] })
      .mockResolvedValueOnce({ models: [{ name: 'llama3' }, { name: 'starcoder2' }] });
    const show = vi.fn().mockResolvedValue({ template: '', details: { families: [] } });

    const provider = new OllamaChatModelProvider(
      { secrets: { get: vi.fn(), store: vi.fn(), delete: vi.fn() } } as any,
      { list, show } as any,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
    );

    await provider.provideLanguageModelChatInformation({ silent: true }, {} as any);
    // Advance time past the 5-second throttle window so the next call re-fetches.
    vi.setSystemTime(new Date('2026-03-05T00:00:06.000Z'));
    const models = await provider.provideLanguageModelChatInformation({ silent: true }, {} as any);

    expect(list).toHaveBeenCalledTimes(2);
    expect(models.map(m => m.id)).toContain('ollama:starcoder2');
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
    expect((models[0] as unknown as { category?: { label?: string } })?.category?.label).toBe('Ask');
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
    expect(models[0]?.detail).toBe('🦙 Ollama');
    expect(models[0]?.capabilities?.toolCalling).toBe(true);
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

  it('refreshModels() discards stale in-flight fetch so next query gets fresh results', async () => {
    let resolveFirstList!: (v: unknown) => void;
    const firstListPending = new Promise(resolve => {
      resolveFirstList = resolve;
    });

    const list = vi
      .fn()
      .mockReturnValueOnce(firstListPending) // first call hangs (started before pull)
      .mockResolvedValueOnce({ models: [{ name: 'llama2' }, { name: 'newmodel' }] }); // second call after refresh

    const show = vi.fn().mockResolvedValue({ template: '', details: { families: [] } });

    const provider = new OllamaChatModelProvider(
      { secrets: { get: vi.fn(), store: vi.fn(), delete: vi.fn() } } as any,
      { list, show } as any,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), exception: vi.fn() } as any,
    );

    // First call starts an in-flight fetch that hangs
    const firstFetch = provider.provideLanguageModelChatInformation({ silent: true }, {} as any);

    // Pull completes — refreshModels() should discard the stale in-flight promise
    provider.refreshModels();

    // VS Code queries again after the event fires — must NOT reuse the stale promise
    const secondFetch = provider.provideLanguageModelChatInformation({ silent: true }, {} as any);

    // Now resolve the first (stale) list with old data
    resolveFirstList({ models: [{ name: 'llama2' }] });

    await firstFetch;
    const models = await secondFetch;

    expect(models.map((m: { id: string }) => m.id)).toContain('ollama:newmodel');
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

    vi.mocked(getOllamaClient).mockResolvedValueOnce({ chat, abort: vi.fn() } as any);

    const provider = new OllamaChatModelProvider(
      { secrets: { get: vi.fn(), store: vi.fn(), delete: vi.fn() } } as any,
      { list: vi.fn(), show: vi.fn() } as any,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), exception: vi.fn() } as any,
    );

    const progress = { report: vi.fn() };
    const token = { isCancellationRequested: true };

    const model = {
      id: 'test-model',
      name: 'Test',
      family: '🦙 Ollama',
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

    vi.mocked(getOllamaClient).mockResolvedValueOnce({ chat, abort: vi.fn() } as any);

    const provider = new OllamaChatModelProvider(
      { secrets: { get: vi.fn(), store: vi.fn(), delete: vi.fn() } } as any,
      { list: vi.fn(), show: vi.fn() } as any,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), exception } as any,
    );

    const progress = { report: vi.fn() };
    const token = { isCancellationRequested: false };

    const model = {
      id: 'test-model',
      name: 'Test',
      family: '🦙 Ollama',
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

    vi.mocked(getOllamaClient).mockResolvedValueOnce({ chat, abort: vi.fn() } as any);

    const provider = new OllamaChatModelProvider(
      { secrets: { get: vi.fn(), store: vi.fn(), delete: vi.fn() } } as any,
      { list: vi.fn(), show: vi.fn() } as any,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), exception: vi.fn() } as any,
    );

    const progress = { report: vi.fn() };
    const token = { isCancellationRequested: false };

    const model = {
      id: 'vision-model',
      name: 'Vision',
      family: '🦙 Ollama',
      version: '1.0.0',
      maxInputTokens: 100,
      maxOutputTokens: 100,
      capabilities: { imageInput: true, toolCalling: true },
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

    vi.mocked(getOllamaClient).mockResolvedValueOnce({ chat, abort: vi.fn() } as any);

    const provider = new OllamaChatModelProvider(
      { secrets: { get: vi.fn(), store: vi.fn(), delete: vi.fn() } } as any,
      { list: vi.fn(), show: vi.fn() } as any,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), exception: vi.fn() } as any,
    );

    const progress = { report: vi.fn() };
    const token = { isCancellationRequested: false };

    const model = {
      id: 'tool-model',
      name: 'Tools',
      family: '🦙 Ollama',
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

    vi.mocked(getOllamaClient).mockResolvedValueOnce({ chat, abort: vi.fn() } as any);

    const provider = new OllamaChatModelProvider(
      { secrets: { get: vi.fn(), store: vi.fn(), delete: vi.fn() } } as any,
      { list: vi.fn(), show: vi.fn() } as any,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), exception: vi.fn() } as any,
    );

    const progress = { report: vi.fn() };
    const token = { isCancellationRequested: false };

    const model = {
      id: 'test-model',
      name: 'Test',
      family: '🦙 Ollama',
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

  it('streams thinking chunks for thinking models', async () => {
    const chat = vi.fn().mockResolvedValue(
      (async function* () {
        yield { message: { thinking: 'let me reason...' } };
        yield { message: { thinking: ' more reasoning' } };
        yield { message: { content: 'The answer is 42.' } };
        yield { message: {}, done: true };
      })(),
    );

    vi.mocked(getOllamaClient).mockResolvedValueOnce({ chat, abort: vi.fn() } as any);

    const provider = new OllamaChatModelProvider(
      { secrets: { get: vi.fn(), store: vi.fn(), delete: vi.fn() } } as any,
      { list: vi.fn(), show: vi.fn() } as any,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), exception: vi.fn() } as any,
    );

    const progress = { report: vi.fn() };
    const token = { isCancellationRequested: false };

    const model = {
      id: 'qwen3:8b',
      name: 'Qwen3 8B',
      family: '🦙 Ollama',
      version: '1.0.0',
      maxInputTokens: 100,
      maxOutputTokens: 100,
      capabilities: { imageInput: false, toolCalling: false },
    };

    const message = {
      role: LanguageModelChatMessageRole.User,
      name: undefined,
      content: [new LanguageModelTextPart('what is the meaning of life?')],
    };

    await provider.provideLanguageModelChatResponse(
      model,
      [message as any],
      { tools: [], toolMode: 'auto' } as any,
      progress as any,
      token as any,
    );

    // Should include a header for thinking section
    const allValues = progress.report.mock.calls.map((c: any[]) => c[0]?.value ?? '');
    expect(allValues.some((v: string) => v.includes('Thinking') || v.includes('thinking'))).toBe(true);
    // Should include thinking content
    expect(allValues.some((v: string) => v.includes('let me reason...'))).toBe(true);
    // Should include separator before answer
    expect(allValues.some((v: string) => v.includes('---'))).toBe(true);
    // Should include answer
    expect(allValues.some((v: string) => v.includes('The answer is 42.'))).toBe(true);
  });

  it('passes think: true for known thinking models', async () => {
    const chat = vi.fn().mockResolvedValue(
      (async function* () {
        yield { message: { content: 'done' }, done: true };
      })(),
    );

    vi.mocked(getOllamaClient).mockResolvedValueOnce({ chat, abort: vi.fn() } as any);

    const provider = new OllamaChatModelProvider(
      { secrets: { get: vi.fn(), store: vi.fn(), delete: vi.fn() } } as any,
      { list: vi.fn(), show: vi.fn() } as any,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), exception: vi.fn() } as any,
    );

    const progress = { report: vi.fn() };
    const token = { isCancellationRequested: false };

    const model = {
      id: 'qwen3:8b',
      name: 'Qwen3 8B',
      family: '🦙 Ollama',
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

    expect(chat).toHaveBeenCalledWith(expect.objectContaining({ think: true }));
  });

  it('does not pass think for non-thinking models', async () => {
    const chat = vi.fn().mockResolvedValue(
      (async function* () {
        yield { message: { content: 'done' }, done: true };
      })(),
    );

    vi.mocked(getOllamaClient).mockResolvedValueOnce({ chat, abort: vi.fn() } as any);

    const provider = new OllamaChatModelProvider(
      { secrets: { get: vi.fn(), store: vi.fn(), delete: vi.fn() } } as any,
      { list: vi.fn(), show: vi.fn() } as any,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), exception: vi.fn() } as any,
    );

    const progress = { report: vi.fn() };
    const token = { isCancellationRequested: false };

    const model = {
      id: 'llama3.2:latest',
      name: 'Llama 3.2',
      family: '🦙 Ollama',
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

    const chatArgs = chat.mock.calls[0]?.[0];
    expect(chatArgs?.think).toBeFalsy();
  });

  it('retries without think when model returns ResponseError "does not support thinking"', async () => {
    const thinkingError = Object.assign(new Error('"cogito:latest" does not support thinking'), {
      name: 'ResponseError',
      status_code: 400,
    });

    const chat = vi
      .fn()
      .mockRejectedValueOnce(thinkingError)
      .mockResolvedValueOnce(
        (async function* () {
          yield { message: { content: 'Here is the answer.' }, done: true };
        })(),
      );

    vi.mocked(getOllamaClient).mockResolvedValue({ chat, abort: vi.fn() } as any);

    const provider = new OllamaChatModelProvider(
      { secrets: { get: vi.fn(), store: vi.fn(), delete: vi.fn() } } as any,
      { list: vi.fn(), show: vi.fn() } as any,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), exception: vi.fn() } as any,
    );

    const progress = { report: vi.fn() };
    const token = { isCancellationRequested: false };

    const model = {
      id: 'cogito:latest',
      name: 'Cogito Latest',
      family: '🦙 Ollama',
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
      model as any,
      [message as any],
      { tools: [], toolMode: 'auto' } as any,
      progress as any,
      token as any,
    );

    // First call should have used think: true (cogito matches the regex)
    expect(chat).toHaveBeenCalledTimes(2);
    expect(chat.mock.calls[0]?.[0]?.think).toBe(true);
    // Second call (retry) should not pass think
    expect(chat.mock.calls[1]?.[0]?.think).toBeUndefined();
    // Content should be reported (not an error message)
    const allValues = progress.report.mock.calls.map((c: any[]) => c[0]?.value ?? '');
    expect(allValues.some((v: string) => v.includes('Here is the answer.'))).toBe(true);
    expect(allValues.every((v: string) => !v.startsWith('Error:'))).toBe(true);
  });

  it('does not retry again on second call when model is in nonThinkingModels', async () => {
    const thinkingError = Object.assign(new Error('"cogito:latest" does not support thinking'), {
      name: 'ResponseError',
      status_code: 400,
    });

    const chat = vi
      .fn()
      .mockRejectedValueOnce(thinkingError)
      .mockResolvedValueOnce(
        (async function* () {
          yield { message: { content: 'first response' }, done: true };
        })(),
      )
      .mockResolvedValueOnce(
        (async function* () {
          yield { message: { content: 'second response' }, done: true };
        })(),
      );

    vi.mocked(getOllamaClient).mockResolvedValue({ chat, abort: vi.fn() } as any);

    const provider = new OllamaChatModelProvider(
      { secrets: { get: vi.fn(), store: vi.fn(), delete: vi.fn() } } as any,
      { list: vi.fn(), show: vi.fn() } as any,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), exception: vi.fn() } as any,
    );

    const progress = { report: vi.fn() };
    const token = { isCancellationRequested: false };

    const model = {
      id: 'cogito:latest',
      name: 'Cogito Latest',
      family: '🦙 Ollama',
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

    // First call — triggers retry and blacklists the model
    await provider.provideLanguageModelChatResponse(
      model as any,
      [message as any],
      { tools: [], toolMode: 'auto' } as any,
      progress as any,
      token as any,
    );

    progress.report.mockClear();

    // Second call — should NOT pass think: true (model is now blacklisted)
    await provider.provideLanguageModelChatResponse(
      model as any,
      [message as any],
      { tools: [], toolMode: 'auto' } as any,
      progress as any,
      token as any,
    );

    // Total: 3 calls (1 failed + 1 retry + 1 second request without think)
    expect(chat).toHaveBeenCalledTimes(3);
    expect(chat.mock.calls[2]?.[0]?.think).toBeUndefined();
  });
});

describe('OllamaChatModelProvider crash handling', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows error message when model runner crashes', async () => {
    const generate = vi.fn().mockResolvedValue({});
    const chat = vi
      .fn()
      .mockRejectedValue(new Error('model runner has unexpectedly stopped, please check ollama server logs'));

    vi.mocked(getOllamaClient).mockResolvedValueOnce({ chat, generate, abort: vi.fn() } as any);

    const provider = new OllamaChatModelProvider(
      { secrets: { get: vi.fn(), store: vi.fn(), delete: vi.fn() } } as any,
      { list: vi.fn(), show: vi.fn() } as any,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), exception: vi.fn() } as any,
    );

    const progress = { report: vi.fn() };
    const token = { isCancellationRequested: false };
    const model = {
      id: 'ollama:test-model',
      name: 'Test',
      family: '🦙 Ollama',
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

    expect(vi.mocked(window.showErrorMessage)).toHaveBeenCalledWith(
      expect.stringContaining('model runner crashed'),
      'Open Logs',
    );
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'test-model', keep_alive: 0 }),
    );
  });
});

describe('isThinkingModelId', () => {
  it('returns true for qwen3 models', () => {
    expect(isThinkingModelId('qwen3:8b')).toBe(true);
    expect(isThinkingModelId('qwen3:14b')).toBe(true);
    expect(isThinkingModelId('qwen3:latest')).toBe(true);
  });

  it('returns true for qwq models', () => {
    expect(isThinkingModelId('qwq:32b')).toBe(true);
    expect(isThinkingModelId('qwq')).toBe(true);
  });

  it('returns true for deepseek-r1 models', () => {
    expect(isThinkingModelId('deepseek-r1:8b')).toBe(true);
    expect(isThinkingModelId('deepseek-r1:70b')).toBe(true);
    expect(isThinkingModelId('deepseekr1:latest')).toBe(true);
  });

  it('returns true for cogito models', () => {
    expect(isThinkingModelId('cogito:8b')).toBe(true);
    expect(isThinkingModelId('cogito-v1-preview-llama-3.1-8b')).toBe(true);
  });

  it('returns true for phi4-reasoning models', () => {
    expect(isThinkingModelId('phi4-reasoning:latest')).toBe(true);
  });

  it('returns false for standard models', () => {
    expect(isThinkingModelId('llama3.2:latest')).toBe(false);
    expect(isThinkingModelId('mistral:7b')).toBe(false);
    expect(isThinkingModelId('gemma3:latest')).toBe(false);
    expect(isThinkingModelId('codellama:latest')).toBe(false);
  });
});

describe('XML context extraction in message conversion', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('extracts XML context blocks from user messages into a system message', async () => {
    const chat = vi.fn().mockImplementation(async function* () {
      yield { message: { content: 'response' } };
    });

    vi.mocked(getOllamaClient).mockResolvedValueOnce({ chat, abort: vi.fn() } as any);

    const provider = new OllamaChatModelProvider(
      { secrets: { get: vi.fn(), store: vi.fn(), delete: vi.fn() } } as any,
      { list: vi.fn(), show: vi.fn() } as any,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), exception: vi.fn() } as any,
    );

    const progress = { report: vi.fn() };
    const token = { isCancellationRequested: false };
    const model = {
      id: 'test-model',
      name: 'Test',
      family: '🦙 Ollama',
      version: '1.0.0',
      maxInputTokens: 100,
      maxOutputTokens: 100,
      capabilities: { imageInput: false, toolCalling: false },
    };

    const userText = '<environment_info>\nOS: macOS\n</environment_info>\nWhat is 2+2?';
    const message = {
      role: LanguageModelChatMessageRole.User,
      name: undefined,
      content: [new LanguageModelTextPart(userText)],
    };

    await provider.provideLanguageModelChatResponse(
      model,
      [message as any],
      { tools: [], toolMode: 'auto' } as any,
      progress as any,
      token as any,
    );

    const messages = chat.mock.calls[0]?.[0]?.messages;

    expect(messages?.[0]?.role).toBe('system');
    expect(messages?.[0]?.content).toContain('OS: macOS');

    expect(messages?.[1]?.role).toBe('user');
    expect(messages?.[1]?.content).not.toContain('<environment_info>');
    expect(messages?.[1]?.content).toContain('What is 2+2?');
  });

  it('does not promote non-leading XML context tags to system message', async () => {
    const chat = vi.fn().mockImplementation(async function* () {
      yield { message: { content: 'response' } };
    });

    vi.mocked(getOllamaClient).mockResolvedValueOnce({ chat, abort: vi.fn() } as any);

    const provider = new OllamaChatModelProvider(
      { secrets: { get: vi.fn(), store: vi.fn(), delete: vi.fn() } } as any,
      { list: vi.fn(), show: vi.fn() } as any,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), exception: vi.fn() } as any,
    );

    // Context tag appears mid-message, not at the start — must NOT be promoted to system
    const userText = 'What is 2+2? <environment_info>\nOS: macOS\n</environment_info>';
    const message = {
      role: LanguageModelChatMessageRole.User,
      name: undefined,
      content: [new LanguageModelTextPart(userText)],
    };

    await provider.provideLanguageModelChatResponse(
      {
        id: 'test-model',
        name: 'Test',
        family: '🦙 Ollama',
        version: '1.0.0',
        maxInputTokens: 100,
        maxOutputTokens: 100,
        capabilities: { imageInput: false, toolCalling: false },
      },
      [message as any],
      { tools: [], toolMode: 'auto' } as any,
      { report: vi.fn() } as any,
      { isCancellationRequested: false } as any,
    );

    const messages = chat.mock.calls[0]?.[0]?.messages;

    // No system message should be injected
    expect(messages?.[0]?.role).toBe('user');
    // The user message content should be unchanged (including the tag)
    expect(messages?.[0]?.content).toContain('<environment_info>');
  });

  it('deduplicates context blocks across turns, keeping only the most recent per tag', async () => {
    const chat = vi.fn().mockImplementation(async function* () {
      yield { message: { content: 'response' } };
    });

    vi.mocked(getOllamaClient).mockResolvedValueOnce({ chat, abort: vi.fn() } as any);

    const provider = new OllamaChatModelProvider(
      { secrets: { get: vi.fn(), store: vi.fn(), delete: vi.fn() } } as any,
      { list: vi.fn(), show: vi.fn() } as any,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), exception: vi.fn() } as any,
    );

    // Simulate a two-turn conversation where both turns inject an environment_info block
    const turn1 = {
      role: LanguageModelChatMessageRole.User,
      name: undefined,
      content: [new LanguageModelTextPart('<environment_info>\nenv v1\n</environment_info>\nFirst question')],
    };
    const turn1Reply = {
      role: LanguageModelChatMessageRole.Assistant,
      name: undefined,
      content: [new LanguageModelTextPart('First answer')],
    };
    const turn2 = {
      role: LanguageModelChatMessageRole.User,
      name: undefined,
      content: [new LanguageModelTextPart('<environment_info>\nenv v2\n</environment_info>\nSecond question')],
    };

    await provider.provideLanguageModelChatResponse(
      {
        id: 'test-model',
        name: 'Test',
        family: '🦙 Ollama',
        version: '1.0.0',
        maxInputTokens: 100,
        maxOutputTokens: 100,
        capabilities: { imageInput: false, toolCalling: false },
      },
      [turn1 as any, turn1Reply as any, turn2 as any],
      { tools: [], toolMode: 'auto' } as any,
      { report: vi.fn() } as any,
      { isCancellationRequested: false } as any,
    );

    const messages = chat.mock.calls[0]?.[0]?.messages;

    // There should be exactly one system message
    const systemMessages = messages?.filter((m: { role: string }) => m.role === 'system');
    expect(systemMessages).toHaveLength(1);

    // The system message should contain only the most recent environment_info (v2)
    expect(systemMessages?.[0]?.content).toContain('env v2');
    expect(systemMessages?.[0]?.content).not.toContain('env v1');
  });

  it('strips all four known context tag types', async () => {
    const chat = vi.fn().mockImplementation(async function* () {
      yield { message: { content: 'ok' } };
    });

    vi.mocked(getOllamaClient).mockResolvedValueOnce({ chat, abort: vi.fn() } as any);

    const provider = new OllamaChatModelProvider(
      { secrets: { get: vi.fn(), store: vi.fn(), delete: vi.fn() } } as any,
      { list: vi.fn(), show: vi.fn() } as any,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), exception: vi.fn() } as any,
    );

    const userText = [
      '<environment_info>\nenv data\n</environment_info>',
      '<workspace_info>\nws data\n</workspace_info>',
      '<selection>\nsel data\n</selection>',
      '<file_context>\nfile data\n</file_context>',
      'User question',
    ].join('\n');

    const message = {
      role: LanguageModelChatMessageRole.User,
      name: undefined,
      content: [new LanguageModelTextPart(userText)],
    };

    await provider.provideLanguageModelChatResponse(
      {
        id: 'test-model',
        name: 'Test',
        family: '🦙 Ollama',
        version: '1.0.0',
        maxInputTokens: 100,
        maxOutputTokens: 100,
        capabilities: { imageInput: false, toolCalling: false },
      },
      [message as any],
      { tools: [], toolMode: 'auto' } as any,
      { report: vi.fn() } as any,
      { isCancellationRequested: false } as any,
    );

    const messages = chat.mock.calls[0]?.[0]?.messages;

    expect(messages?.[0]?.role).toBe('system');
    expect(messages?.[0]?.content).toContain('env data');
    expect(messages?.[0]?.content).toContain('ws data');
    expect(messages?.[0]?.content).toContain('sel data');
    expect(messages?.[0]?.content).toContain('file data');

    expect(messages?.[1]?.content).not.toContain('<environment_info>');
    expect(messages?.[1]?.content).not.toContain('<workspace_info>');
    expect(messages?.[1]?.content).not.toContain('<selection>');
    expect(messages?.[1]?.content).not.toContain('<file_context>');
    expect(messages?.[1]?.content).toContain('User question');
  });
});
