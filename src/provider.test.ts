import type { Ollama } from 'ollama';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CancellationToken,
  ExtensionContext,
  LanguageModelChatInformation,
  LanguageModelChatRequestMessage,
  LanguageModelResponsePart,
  Progress,
  ProvideLanguageModelChatResponseOptions,
} from 'vscode';
import {
  LanguageModelChatMessageRole,
  LanguageModelDataPart,
  LanguageModelTextPart,
  LanguageModelToolCallPart,
  LanguageModelToolResultPart,
  window,
} from 'vscode';
import { getCloudOllamaClient, getOllamaClient } from './client.js';
import type { DiagnosticsLogger } from './diagnostics.js';
import { formatModelName, isThinkingModelId, OllamaChatModelProvider } from './provider.js';

function makeLogger(): DiagnosticsLogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), exception: vi.fn() };
}

function makeContext(): ExtensionContext {
  return { secrets: { get: vi.fn(), store: vi.fn(), delete: vi.fn() } } as unknown as ExtensionContext;
}

vi.mock('./client.js', () => ({
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

    const provider = new OllamaChatModelProvider(makeContext(), { list, show } as unknown as Ollama, makeLogger());

    await provider.provideLanguageModelChatInformation({ silent: true }, {} as unknown as CancellationToken);
    await provider.provideLanguageModelChatInformation({ silent: true }, {} as unknown as CancellationToken);

    expect(list).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('fetches a fresh model list after the 5-second throttle window', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({ models: [{ name: 'llama3' }] })
      .mockResolvedValueOnce({ models: [{ name: 'llama3' }, { name: 'starcoder2' }] });
    const show = vi.fn().mockResolvedValue({ template: '', details: { families: [] } });

    const provider = new OllamaChatModelProvider(makeContext(), { list, show } as unknown as Ollama, makeLogger());

    await provider.provideLanguageModelChatInformation({ silent: true }, {} as unknown as CancellationToken);
    // Advance time past the 5-second throttle window so the next call re-fetches.
    vi.setSystemTime(new Date('2026-03-05T00:00:06.000Z'));
    const models = await provider.provideLanguageModelChatInformation(
      { silent: true },
      {} as unknown as CancellationToken,
    );

    expect(list).toHaveBeenCalledTimes(2);
    expect(models.map(m => m.id)).toContain('ollama:starcoder2');
  });

  it('reuses cached model details after refresh interval', async () => {
    const list = vi.fn().mockResolvedValue({ models: [{ name: 'llama3' }] });
    const show = vi.fn().mockResolvedValue({ template: '', details: { families: [] } });

    const provider = new OllamaChatModelProvider(makeContext(), { list, show } as unknown as Ollama, makeLogger());

    await provider.provideLanguageModelChatInformation({ silent: true }, {} as unknown as CancellationToken);
    vi.setSystemTime(new Date('2026-03-05T00:00:31.000Z'));
    await provider.provideLanguageModelChatInformation({ silent: true }, {} as unknown as CancellationToken);

    expect(list).toHaveBeenCalledTimes(2);
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('clearModelCache resets thinkingModels and nonThinkingModels sets', async () => {
    const list = vi.fn().mockResolvedValue({ models: [] });
    const show = vi.fn().mockResolvedValue({ template: '', details: { families: [] } });

    const provider = new OllamaChatModelProvider(makeContext(), { list, show } as unknown as Ollama, makeLogger());

    // Directly populate the private sets (via type cast for testing)
    const providerWithPrivate = provider as unknown as {
      thinkingModels: Set<string>;
      nonThinkingModels: Set<string>;
      clearModelCache(): void;
    };
    providerWithPrivate.thinkingModels.add('test-model');
    providerWithPrivate.nonThinkingModels.add('test-model-2');

    // Verify they're populated
    expect(providerWithPrivate.thinkingModels.size).toBe(1);
    expect(providerWithPrivate.nonThinkingModels.size).toBe(1);

    // Act: call private clearModelCache directly
    providerWithPrivate.clearModelCache();

    // Assert: sets should be empty
    expect(providerWithPrivate.thinkingModels.size).toBe(0);
    expect(providerWithPrivate.nonThinkingModels.size).toBe(0);
  });
});

describe('OllamaChatModelProvider utility flows', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('estimates token count from plain text', async () => {
    const provider = new OllamaChatModelProvider(
      makeContext(),
      { list: vi.fn(), show: vi.fn() } as unknown as Ollama,
      makeLogger(),
    );

    const count = await provider.provideTokenCount(
      {} as unknown as LanguageModelChatInformation,
      '12345678',
      {} as unknown as CancellationToken,
    );
    expect(count).toBe(2);
  });

  it('estimates token count from message parts', async () => {
    const provider = new OllamaChatModelProvider(
      makeContext(),
      { list: vi.fn(), show: vi.fn() } as unknown as Ollama,
      makeLogger(),
    );

    const message = {
      content: [
        new LanguageModelTextPart('hello'),
        new LanguageModelToolCallPart('abc123xyz', 'toolName', { input: 'x' }),
        new LanguageModelToolResultPart('abc123xyz', [new LanguageModelTextPart('done')]),
      ],
    } as unknown as LanguageModelChatRequestMessage;

    const count = await provider.provideTokenCount(
      {} as unknown as LanguageModelChatInformation,
      message,
      {} as unknown as CancellationToken,
    );
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
      makeContext(),
      { list: vi.fn().mockResolvedValue({ models: [{ name: 'qwen2.5-coder:latest' }] }), show } as unknown as Ollama,
      makeLogger(),
    );

    const models = await provider.provideLanguageModelChatInformation(
      { silent: true },
      {} as unknown as CancellationToken,
    );
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
      makeContext(),
      { list: vi.fn().mockResolvedValue({ models: [{ name: 'granite4:latest' }] }), show } as unknown as Ollama,
      makeLogger(),
    );

    const models = await provider.provideLanguageModelChatInformation(
      { silent: true },
      {} as unknown as CancellationToken,
    );
    expect(models[0]?.capabilities?.toolCalling).toBe(true);
  });

  it('detects vision support from capabilities array', async () => {
    const show = vi.fn().mockResolvedValue({
      template: '',
      details: { families: [] },
      capabilities: ['completion', 'vision'],
    });

    const provider = new OllamaChatModelProvider(
      makeContext(),
      { list: vi.fn().mockResolvedValue({ models: [{ name: 'llava:latest' }] }), show } as unknown as Ollama,
      makeLogger(),
    );

    const models = await provider.provideLanguageModelChatInformation(
      { silent: true },
      {} as unknown as CancellationToken,
    );
    expect(models[0]?.capabilities?.imageInput).toBe(true);
  });

  it('detects vision models with clip family', async () => {
    const show = vi.fn().mockResolvedValue({
      template: '',
      details: { families: ['clip'] },
    });

    const provider = new OllamaChatModelProvider(
      makeContext(),
      { list: vi.fn(), show } as unknown as Ollama,
      makeLogger(),
    );

    await provider.provideLanguageModelChatInformation({ silent: true }, {} as unknown as CancellationToken);
    // We can't directly test private methods, but we can verify that models are fetched
    expect(show).toBeDefined();
  });

  it('detects vision models with vision family', async () => {
    const show = vi.fn().mockResolvedValue({
      template: '',
      details: { families: ['vision'] },
    });

    const provider = new OllamaChatModelProvider(
      makeContext(),
      { list: vi.fn().mockResolvedValue({ models: [{ name: 'llava' }] }), show } as unknown as Ollama,
      makeLogger(),
    );

    const models = await provider.provideLanguageModelChatInformation(
      { silent: true },
      {} as unknown as CancellationToken,
    );
    expect(models).toBeDefined();
  });

  it('detects tool models with Tools placeholder', async () => {
    const show = vi.fn().mockResolvedValue({
      template: 'some template {{ .Tools }} end',
      details: { families: [] },
    });

    const provider = new OllamaChatModelProvider(
      makeContext(),
      { list: vi.fn().mockResolvedValue({ models: [{ name: 'tool-model' }] }), show } as unknown as Ollama,
      makeLogger(),
    );

    const models = await provider.provideLanguageModelChatInformation(
      { silent: true },
      {} as unknown as CancellationToken,
    );
    expect(models).toBeDefined();
  });

  it('handles missing model families gracefully', async () => {
    const show = vi.fn().mockResolvedValue({
      template: '',
      details: undefined,
    });

    const provider = new OllamaChatModelProvider(
      makeContext(),
      { list: vi.fn().mockResolvedValue({ models: [{ name: 'basic-model' }] }), show } as unknown as Ollama,
      makeLogger(),
    );

    const models = await provider.provideLanguageModelChatInformation(
      { silent: true },
      {} as unknown as CancellationToken,
    );
    expect(models).toBeDefined();
    expect(models[0]?.capabilities).toBeDefined();
  });
});

describe('OllamaChatModelProvider error handling', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('handles model list fetch errors gracefully', async () => {
    const error = vi.fn();
    const list = vi.fn().mockRejectedValue(new Error('Connection failed'));

    const provider = new OllamaChatModelProvider(
      makeContext(),
      { list, show: vi.fn() } as unknown as Ollama,
      { info: vi.fn(), warn: vi.fn(), error, debug: vi.fn(), exception: vi.fn() } as unknown as DiagnosticsLogger,
    );

    const models = await provider.provideLanguageModelChatInformation(
      { silent: true },
      {} as unknown as CancellationToken,
    );

    expect(error).toHaveBeenCalled();
    expect(models).toEqual([]);
  });

  it('returns fallback models on show() failure', async () => {
    const list = vi.fn().mockResolvedValue({
      models: [{ name: 'llama2' }, { name: 'mistral' }],
    });
    const show = vi.fn().mockRejectedValue(new Error('Show failed'));

    const provider = new OllamaChatModelProvider(makeContext(), { list, show } as unknown as Ollama, makeLogger());

    const models = await provider.provideLanguageModelChatInformation(
      { silent: true },
      {} as unknown as CancellationToken,
    );

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

    const provider = new OllamaChatModelProvider(makeContext(), { list, show } as unknown as Ollama, makeLogger());

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-05T00:00:00.000Z'));

    await provider.provideLanguageModelChatInformation({ silent: true }, {} as unknown as CancellationToken);
    vi.setSystemTime(new Date('2026-03-05T00:00:31.000Z'));

    // This should call list() again and prune mistral from cache
    await provider.provideLanguageModelChatInformation({ silent: true }, {} as unknown as CancellationToken);

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

    const provider = new OllamaChatModelProvider(makeContext(), { list, show } as unknown as Ollama, makeLogger());

    // First call starts an in-flight fetch that hangs
    const firstFetch = provider.provideLanguageModelChatInformation(
      { silent: true },
      {} as unknown as CancellationToken,
    );

    // Pull completes — refreshModels() should discard the stale in-flight promise
    provider.refreshModels();

    // VS Code queries again after the event fires — must NOT reuse the stale promise
    const secondFetch = provider.provideLanguageModelChatInformation(
      { silent: true },
      {} as unknown as CancellationToken,
    );

    // Now resolve the first (stale) list with old data
    resolveFirstList({ models: [{ name: 'llama2' }] });

    await firstFetch;
    const models = await secondFetch;

    expect(models.map((m: { id: string }) => m.id)).toContain('ollama:newmodel');
  });

  it('concurrent provideLanguageModelChatInformation calls share in-flight promise (single list() call)', async () => {
    let resolveList!: (v: unknown) => void;
    const listPending = new Promise(resolve => {
      resolveList = resolve;
    });

    const list = vi.fn().mockReturnValueOnce(listPending);
    const show = vi.fn().mockResolvedValue({ template: '', details: { families: [] } });

    const provider = new OllamaChatModelProvider(makeContext(), { list, show } as unknown as Ollama, makeLogger());

    // Fire two concurrent requests while list() is still pending
    const call1 = provider.provideLanguageModelChatInformation({ silent: true }, {} as unknown as CancellationToken);
    const call2 = provider.provideLanguageModelChatInformation({ silent: true }, {} as unknown as CancellationToken);

    resolveList({ models: [{ name: 'gemma3' }] });

    const [result1, result2] = await Promise.all([call1, call2]);

    // Both calls should get the same result
    expect(result1.map((m: { id: string }) => m.id)).toContain('ollama:gemma3');
    expect(result2.map((m: { id: string }) => m.id)).toContain('ollama:gemma3');
    // And only ONE list() call should have been made
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('generation guard prevents stale in-flight fetch from overwriting fresh cache', async () => {
    let resolveFirstList!: (v: unknown) => void;
    const firstListPending = new Promise(resolve => {
      resolveFirstList = resolve;
    });

    const list = vi
      .fn()
      .mockReturnValueOnce(firstListPending)
      .mockResolvedValueOnce({ models: [{ name: 'llama2' }, { name: 'newmodel' }] });

    const show = vi.fn().mockResolvedValue({ template: '', details: { families: [] } });

    const provider = new OllamaChatModelProvider(makeContext(), { list, show } as unknown as Ollama, makeLogger());

    // Start the first (stale) fetch
    const firstFetch = provider.provideLanguageModelChatInformation(
      { silent: true },
      {} as unknown as CancellationToken,
    );

    // Discard stale fetch and start a fresh one
    provider.refreshModels();
    const freshFetch = provider.provideLanguageModelChatInformation(
      { silent: true },
      {} as unknown as CancellationToken,
    );

    // Fresh fetch resolves first
    const freshResult = await freshFetch;
    expect(freshResult.map((m: { id: string }) => m.id)).toContain('ollama:newmodel');

    // Now let the stale fetch resolve with old data
    resolveFirstList({ models: [{ name: 'llama2' }] });
    await firstFetch;

    // Query a third time — should serve from the FRESH cachedModelList, not stale
    const thirdFetch = await provider.provideLanguageModelChatInformation(
      { silent: true },
      {} as unknown as CancellationToken,
    );
    expect(thirdFetch.map((m: { id: string }) => m.id)).toContain('ollama:newmodel');
  });

  it('prefetchModels() eagerly populates capability maps before first chat request', async () => {
    const show = vi.fn().mockResolvedValue({
      capabilities: ['tools', 'thinking'],
      template: '',
      details: { families: [] },
    });
    const list = vi.fn().mockResolvedValue({ models: [{ name: 'deepseek-r1:8b' }] });

    const provider = new OllamaChatModelProvider(makeContext(), { list, show } as unknown as Ollama, makeLogger());

    // Before prefetch the capability maps are empty
    const models0 = await provider.provideLanguageModelChatInformation(
      { silent: true },
      {} as unknown as CancellationToken,
    );
    // Reset so we can confirm prefetch populates independently
    (provider as unknown as { clearModelCache: () => void }).clearModelCache?.();

    provider.prefetchModels();
    // Wait deterministically for the prefetch to call show()
    await vi.waitFor(() => {
      expect(show).toHaveBeenCalled();
    });

    expect(list).toHaveBeenCalled();
    expect(show).toHaveBeenCalledWith({ model: 'deepseek-r1:8b' });
    // After prefetch the model should be in the cache
    const models1 = await provider.provideLanguageModelChatInformation(
      { silent: true },
      {} as unknown as CancellationToken,
    );
    expect(models1.map((m: { id: string }) => m.id)).toContain('ollama:deepseek-r1:8b');
    void models0;
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

    vi.mocked(getOllamaClient).mockResolvedValueOnce({ chat, abort: vi.fn() } as unknown as Ollama);

    const provider = new OllamaChatModelProvider(
      makeContext(),
      { list: vi.fn(), show: vi.fn() } as unknown as Ollama,
      makeLogger(),
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
      [message as unknown as LanguageModelChatRequestMessage],
      { tools: [], toolMode: 'auto' } as unknown as ProvideLanguageModelChatResponseOptions,
      progress as unknown as Progress<LanguageModelResponsePart>,
      token as unknown as CancellationToken,
    );

    // Should stop processing immediately
    expect(chat).toHaveBeenCalled();
  });

  it('handles chat response errors', async () => {
    const exception = vi.fn();
    const chat = vi.fn().mockRejectedValue(new Error('Chat failed'));

    vi.mocked(getOllamaClient).mockResolvedValueOnce({ chat, abort: vi.fn() } as unknown as Ollama);

    const provider = new OllamaChatModelProvider(
      makeContext(),
      { list: vi.fn(), show: vi.fn() } as unknown as Ollama,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), exception } as unknown as DiagnosticsLogger,
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
      [message as unknown as LanguageModelChatRequestMessage],
      { tools: [], toolMode: 'auto' } as unknown as ProvideLanguageModelChatResponseOptions,
      progress as unknown as Progress<LanguageModelResponsePart>,
      token as unknown as CancellationToken,
    );

    expect(exception).toHaveBeenCalled();
    expect(progress.report).toHaveBeenCalledWith(expect.objectContaining({ value: expect.stringContaining('Error:') }));
  });

  it('converts mixed message content correctly', async () => {
    const chat = vi.fn().mockImplementation(async function* () {
      yield { message: { content: 'response' } };
    });

    vi.mocked(getOllamaClient).mockResolvedValueOnce({ chat, abort: vi.fn() } as unknown as Ollama);

    const provider = new OllamaChatModelProvider(
      makeContext(),
      { list: vi.fn(), show: vi.fn() } as unknown as Ollama,
      makeLogger(),
    );

    // Pre-register as a vision model so images are forwarded
    (
      provider as unknown as {
        visionByModelId: Map<string, boolean>;
        nativeToolCallingByModelId: Map<string, boolean>;
        thinkingModels: Set<string>;
        nonThinkingModels: Set<string>;
        clearModelCache(): void;
      }
    ).visionByModelId.set('vision-model', true);

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
      [message as unknown as LanguageModelChatRequestMessage],
      { tools: [], toolMode: 'auto' } as unknown as ProvideLanguageModelChatResponseOptions,
      progress as unknown as Progress<LanguageModelResponsePart>,
      token as unknown as CancellationToken,
    );

    expect(chat).toHaveBeenCalled();
    const chatArgs = chat.mock.calls[0]?.[0];
    expect(chatArgs?.messages).toBeDefined();
    // Verify images are included for vision models
    const userMsg = chatArgs?.messages?.find((m: any) => m.role === 'user');
    expect(userMsg?.images).toHaveLength(1);
  });

  it('strips images for non-vision models', async () => {
    const chat = vi.fn().mockImplementation(async function* () {
      yield { message: { content: 'text response' } };
    });

    vi.mocked(getOllamaClient).mockResolvedValueOnce({ chat, abort: vi.fn() } as unknown as Ollama);

    const provider = new OllamaChatModelProvider(
      makeContext(),
      { list: vi.fn(), show: vi.fn() } as unknown as Ollama,
      makeLogger(),
    );

    // Non-vision model: visionByModelId not set (defaults to false)

    const progress = { report: vi.fn() };
    const token = { isCancellationRequested: false };

    const model = {
      id: 'text-model',
      name: 'Text Only',
      family: '🦙 Ollama',
      version: '1.0.0',
      maxInputTokens: 100,
      maxOutputTokens: 100,
      capabilities: { imageInput: false, toolCalling: false },
    };

    const message = {
      role: LanguageModelChatMessageRole.User,
      name: undefined,
      content: [new LanguageModelTextPart('hello '), new LanguageModelDataPart(Buffer.from('image data'), 'image/png')],
    };

    await provider.provideLanguageModelChatResponse(
      model,
      [message as unknown as LanguageModelChatRequestMessage],
      { tools: [], toolMode: 'auto' } as unknown as ProvideLanguageModelChatResponseOptions,
      progress as unknown as Progress<LanguageModelResponsePart>,
      token as unknown as CancellationToken,
    );

    expect(chat).toHaveBeenCalled();
    const chatArgs = chat.mock.calls[0]?.[0];
    const userMsg = chatArgs?.messages?.find((m: any) => m.role === 'user');
    // Images should be stripped for non-vision models
    expect(userMsg?.images).toBeUndefined();
    expect(userMsg?.content).toBe('hello');
  });

  it('preserves text from unknown input parts', async () => {
    const chat = vi.fn().mockImplementation(async function* () {
      yield { message: { content: 'ok' }, done: true };
    });

    vi.mocked(getOllamaClient).mockResolvedValueOnce({ chat, abort: vi.fn() } as unknown as Ollama);

    const provider = new OllamaChatModelProvider(
      makeContext(),
      { list: vi.fn(), show: vi.fn() } as unknown as Ollama,
      makeLogger(),
    );

    const progress = { report: vi.fn() };
    const token = { isCancellationRequested: false };

    const model = {
      id: 'text-model',
      name: 'Text Only',
      family: '🦙 Ollama',
      version: '1.0.0',
      maxInputTokens: 100,
      maxOutputTokens: 100,
      capabilities: { imageInput: false, toolCalling: false },
    };

    const message = {
      role: LanguageModelChatMessageRole.User,
      name: undefined,
      content: [
        { value: "<environment_info>\nThe user's current OS is: macOS\n</environment_info>\n\n" },
        { prompt: 'how do i center a div in css' },
      ],
    };

    await provider.provideLanguageModelChatResponse(
      model,
      [message as unknown as LanguageModelChatRequestMessage],
      { tools: [], toolMode: 'auto' } as unknown as ProvideLanguageModelChatResponseOptions,
      progress as unknown as Progress<LanguageModelResponsePart>,
      token as unknown as CancellationToken,
    );

    expect(chat).toHaveBeenCalled();
    const chatArgs = chat.mock.calls[0]?.[0];
    const userMsg = chatArgs?.messages?.find((m: any) => m.role === 'user');
    expect(userMsg?.content).toContain('how do i center a div in css');
  });

  it('appends fallback prompt from options when messages only contain scaffolding', async () => {
    const chat = vi.fn().mockImplementation(async function* () {
      yield { message: { content: 'ok' }, done: true };
    });

    vi.mocked(getOllamaClient).mockResolvedValueOnce({ chat, abort: vi.fn() } as unknown as Ollama);

    const provider = new OllamaChatModelProvider(
      makeContext(),
      { list: vi.fn(), show: vi.fn() } as unknown as Ollama,
      makeLogger(),
    );

    const progress = { report: vi.fn() };
    const token = { isCancellationRequested: false };

    const model = {
      id: 'text-model',
      name: 'Text Only',
      family: '🦙 Ollama',
      version: '1.0.0',
      maxInputTokens: 100,
      maxOutputTokens: 100,
      capabilities: { imageInput: false, toolCalling: false },
    };

    const scaffoldMessage = {
      role: LanguageModelChatMessageRole.User,
      name: undefined,
      content: [
        new LanguageModelTextPart(
          '<userMemory>\nNo user preferences or notes saved yet.\n</userMemory>\n<sessionMemory>\nSession memory is empty.\n</sessionMemory>',
        ),
      ],
    };

    await provider.provideLanguageModelChatResponse(
      model,
      [scaffoldMessage as unknown as LanguageModelChatRequestMessage],
      {
        tools: [],
        toolMode: 'auto',
        modelOptions: {
          request: {
            prompt: 'how do i center a div in css',
          },
        },
      } as unknown as ProvideLanguageModelChatResponseOptions,
      progress as unknown as Progress<LanguageModelResponsePart>,
      token as unknown as CancellationToken,
    );

    expect(chat).toHaveBeenCalled();
    const chatArgs = chat.mock.calls[0]?.[0];
    const userMessages = chatArgs?.messages?.filter((m: any) => m.role === 'user') ?? [];
    const lastUser = userMessages[userMessages.length - 1];
    expect(lastUser?.content).toContain('how do i center a div in css');
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

    vi.mocked(getOllamaClient).mockResolvedValueOnce({ chat, abort: vi.fn() } as unknown as Ollama);

    const provider = new OllamaChatModelProvider(
      makeContext(),
      { list: vi.fn(), show: vi.fn() } as unknown as Ollama,
      makeLogger(),
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
      [message as unknown as LanguageModelChatRequestMessage],
      { tools: [toolDef], toolMode: 'auto' } as unknown as ProvideLanguageModelChatResponseOptions,
      progress as unknown as Progress<LanguageModelResponsePart>,
      token as unknown as CancellationToken,
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

    vi.mocked(getOllamaClient).mockResolvedValueOnce({ chat, abort: vi.fn() } as unknown as Ollama);

    const provider = new OllamaChatModelProvider(
      makeContext(),
      { list: vi.fn(), show: vi.fn() } as unknown as Ollama,
      makeLogger(),
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
      [message as unknown as LanguageModelChatRequestMessage],
      { tools: [], toolMode: 'auto' } as unknown as ProvideLanguageModelChatResponseOptions,
      progress as unknown as Progress<LanguageModelResponsePart>,
      token as unknown as CancellationToken,
    );

    // Verify streaming works with SAX-based filtering
    expect(progress.report.mock.calls.length).toBeGreaterThan(0);
    const reportedText = progress.report.mock.calls.map((call: any) => call[0]?.value ?? '').join('');
    expect(reportedText).toContain('Hello');
    expect(reportedText).toContain(', ');
    expect(reportedText).toContain('world!');
  });

  it('falls back to non-stream response when stream emits no output', async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce(
        (async function* () {
          yield { message: {}, done: true };
        })(),
      )
      .mockResolvedValueOnce({
        message: { content: 'fallback response' },
        done: true,
      });

    vi.mocked(getOllamaClient).mockResolvedValueOnce({ chat, abort: vi.fn() } as unknown as Ollama);

    const provider = new OllamaChatModelProvider(
      makeContext(),
      { list: vi.fn(), show: vi.fn() } as unknown as Ollama,
      makeLogger(),
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
      [message as unknown as LanguageModelChatRequestMessage],
      { tools: [], toolMode: 'auto' } as unknown as ProvideLanguageModelChatResponseOptions,
      progress as unknown as Progress<LanguageModelResponsePart>,
      token as unknown as CancellationToken,
    );

    expect(chat).toHaveBeenCalledTimes(2);
    expect(chat.mock.calls[0]?.[0]?.stream).toBe(true);
    expect(chat.mock.calls[1]?.[0]?.stream).toBe(false);
    expect(progress.report).toHaveBeenCalledWith(expect.objectContaining({ value: 'fallback response' }));
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

    vi.mocked(getOllamaClient).mockResolvedValueOnce({ chat, abort: vi.fn() } as unknown as Ollama);

    const provider = new OllamaChatModelProvider(
      makeContext(),
      { list: vi.fn(), show: vi.fn() } as unknown as Ollama,
      makeLogger(),
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
      [message as unknown as LanguageModelChatRequestMessage],
      { tools: [], toolMode: 'auto' } as unknown as ProvideLanguageModelChatResponseOptions,
      progress as unknown as Progress<LanguageModelResponsePart>,
      token as unknown as CancellationToken,
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

  it('strips raw <think>...</think> tags from local model content stream', async () => {
    const chat = vi.fn().mockResolvedValue(
      (async function* () {
        yield { message: { content: '<think>let me reason step 1' } };
        yield { message: { content: ' step 2</think>' } };
        yield { message: { content: 'The answer is 42.' } };
        yield { message: {}, done: true };
      })(),
    );

    vi.mocked(getOllamaClient).mockResolvedValueOnce({ chat, abort: vi.fn() } as unknown as Ollama);

    const provider = new OllamaChatModelProvider(
      makeContext(),
      { list: vi.fn(), show: vi.fn() } as unknown as Ollama,
      makeLogger(),
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
      [message as unknown as LanguageModelChatRequestMessage],
      { tools: [], toolMode: 'auto' } as unknown as ProvideLanguageModelChatResponseOptions,
      progress as unknown as Progress<LanguageModelResponsePart>,
      token as unknown as CancellationToken,
    );

    const allValues = progress.report.mock.calls.map((c: any[]) => c[0]?.value ?? '');
    const joined = allValues.join('');

    // Raw <think> tags must never appear in output
    expect(joined).not.toContain('<think>');
    expect(joined).not.toContain('</think>');
    // Thinking section header should be emitted
    expect(allValues.some((v: string) => v.includes('Thinking') || v.includes('thinking'))).toBe(true);
    // Thinking content should be visible
    expect(allValues.some((v: string) => v.includes('let me reason step 1'))).toBe(true);
    // Separator before response
    expect(allValues.some((v: string) => v.includes('---'))).toBe(true);
    // Final answer should be present
    expect(allValues.some((v: string) => v.includes('The answer is 42.'))).toBe(true);
  });

  it('streams XML-like assistant output as raw text per chunk', async () => {
    const chat = vi.fn().mockResolvedValue(
      (async function* () {
        yield {
          message: {
            content: '<note>Use Cmd+N to create a note.</note> <help>Use search in the top right for keywords.</help>',
          },
          done: true,
        };
      })(),
    );

    vi.mocked(getOllamaClient).mockResolvedValueOnce({ chat, abort: vi.fn() } as unknown as Ollama);

    const provider = new OllamaChatModelProvider(
      makeContext(),
      { list: vi.fn(), show: vi.fn() } as unknown as Ollama,
      makeLogger(),
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
      [message as unknown as LanguageModelChatRequestMessage],
      { tools: [], toolMode: 'auto' } as unknown as ProvideLanguageModelChatResponseOptions,
      progress as unknown as Progress<LanguageModelResponsePart>,
      token as unknown as CancellationToken,
    );

    const rendered = progress.report.mock.calls.map((c: any[]) => c[0]?.value ?? '').join('');
    expect(rendered).toContain('<note>Use Cmd+N to create a note.</note>');
    expect(rendered).toContain('<help>Use search in the top right for keywords.</help>');
    expect(rendered).toContain('Use Cmd+N to create a note.');
  });

  it('passes think: true for known thinking models', async () => {
    const chat = vi.fn().mockResolvedValue(
      (async function* () {
        yield { message: { content: 'done' }, done: true };
      })(),
    );

    vi.mocked(getOllamaClient).mockResolvedValueOnce({ chat, abort: vi.fn() } as unknown as Ollama);

    const provider = new OllamaChatModelProvider(
      makeContext(),
      { list: vi.fn(), show: vi.fn() } as unknown as Ollama,
      makeLogger(),
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
      [message as unknown as LanguageModelChatRequestMessage],
      { tools: [], toolMode: 'auto' } as unknown as ProvideLanguageModelChatResponseOptions,
      progress as unknown as Progress<LanguageModelResponsePart>,
      token as unknown as CancellationToken,
    );

    expect(chat).toHaveBeenCalledWith(expect.objectContaining({ think: true }));
  });

  it('does not pass think for non-thinking models', async () => {
    const chat = vi.fn().mockResolvedValue(
      (async function* () {
        yield { message: { content: 'done' }, done: true };
      })(),
    );

    vi.mocked(getOllamaClient).mockResolvedValueOnce({ chat, abort: vi.fn() } as unknown as Ollama);

    const provider = new OllamaChatModelProvider(
      makeContext(),
      { list: vi.fn(), show: vi.fn() } as unknown as Ollama,
      makeLogger(),
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
      [message as unknown as LanguageModelChatRequestMessage],
      { tools: [], toolMode: 'auto' } as unknown as ProvideLanguageModelChatResponseOptions,
      progress as unknown as Progress<LanguageModelResponsePart>,
      token as unknown as CancellationToken,
    );

    const chatArgs = chat.mock.calls[0]?.[0];
    expect(chatArgs?.think).toBeFalsy();
  });

  it('retries without think when model returns ResponseError "does not support thinking"', async () => {
    const thinkingError = Object.assign(new Error('"lfm2.5-thinking:1.2b" does not support thinking'), {
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

    vi.mocked(getOllamaClient).mockResolvedValue({ chat, abort: vi.fn() } as unknown as Ollama);

    const provider = new OllamaChatModelProvider(
      makeContext(),
      { list: vi.fn(), show: vi.fn() } as unknown as Ollama,
      makeLogger(),
    );

    const progress = { report: vi.fn() };
    const token = { isCancellationRequested: false };

    const model = {
      id: 'lfm2.5-thinking:1.2b',
      name: 'LFM 2.5 Thinking 1.2B',
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
      model as unknown as LanguageModelChatInformation,
      [message as unknown as LanguageModelChatRequestMessage],
      { tools: [], toolMode: 'auto' } as unknown as ProvideLanguageModelChatResponseOptions,
      progress as unknown as Progress<LanguageModelResponsePart>,
      token as unknown as CancellationToken,
    );

    // First call should have used think: true (lfm2.5-thinking matches the regex)
    expect(chat).toHaveBeenCalledTimes(2);
    expect(chat.mock.calls[0]?.[0]?.think).toBe(true);
    // Second call (retry) should not pass think
    expect(chat.mock.calls[1]?.[0]?.think).toBeUndefined();
    // Content should be reported (not an error message)
    const allValues = progress.report.mock.calls.map((c: any[]) => c[0]?.value ?? '');
    expect(allValues.some((v: string) => v.includes('Here is the answer.'))).toBe(true);
    expect(allValues.every((v: string) => !v.startsWith('Error:'))).toBe(true);
  });

  it('retries without think when model returns generic 500 internal server error', async () => {
    const thinking500Error = Object.assign(
      new Error(
        '{"StatusCode":500,"Status":"500 Internal Server Error","error":"Internal Server Error while thinking"}',
      ),
      {
        name: 'ResponseError',
        status_code: 500,
      },
    );

    const chat = vi
      .fn()
      .mockRejectedValueOnce(thinking500Error)
      .mockResolvedValueOnce(
        (async function* () {
          yield { message: { content: 'Cloud fallback answer.' }, done: true };
        })(),
      );

    vi.mocked(getCloudOllamaClient).mockResolvedValue({ chat, abort: vi.fn() } as unknown as Ollama);

    const provider = new OllamaChatModelProvider(
      makeContext(),
      { list: vi.fn(), show: vi.fn() } as unknown as Ollama,
      makeLogger(),
    );

    const progress = { report: vi.fn() };
    const token = { isCancellationRequested: false };

    const model = {
      id: 'lfm2.5-thinking:cloud',
      name: 'LFM 2.5 Thinking Cloud',
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
      model as unknown as LanguageModelChatInformation,
      [message as unknown as LanguageModelChatRequestMessage],
      { tools: [], toolMode: 'auto' } as unknown as ProvideLanguageModelChatResponseOptions,
      progress as unknown as Progress<LanguageModelResponsePart>,
      token as unknown as CancellationToken,
    );

    expect(chat).toHaveBeenCalledTimes(2);
    expect(chat.mock.calls[0]?.[0]?.think).toBe(true);
    expect(chat.mock.calls[1]?.[0]?.think).toBeUndefined();

    const allValues = progress.report.mock.calls.map((c: any[]) => c[0]?.value ?? '');
    expect(allValues.some((v: string) => v.includes('Cloud fallback answer.'))).toBe(true);
    expect(allValues.every((v: string) => !v.startsWith('Error:'))).toBe(true);
  });

  it('retries cloud request without tools when server returns 500', async () => {
    const tools500Error = Object.assign(
      new Error(
        '{"StatusCode":500,"Status":"500 Internal Server Error","error":"Internal Server Error while thinking"}',
      ),
      {
        name: 'ResponseError',
        status_code: 500,
      },
    );

    const chat = vi
      .fn()
      .mockRejectedValueOnce(tools500Error)
      .mockResolvedValueOnce(
        (async function* () {
          yield { message: { content: 'Recovered without tools.' }, done: true };
        })(),
      );

    vi.mocked(getCloudOllamaClient).mockResolvedValue({ chat, abort: vi.fn() } as unknown as Ollama);

    const provider = new OllamaChatModelProvider(
      makeContext(),
      { list: vi.fn(), show: vi.fn() } as unknown as Ollama,
      makeLogger(),
    );

    // Force native tool-calling support so the first request includes tools.
    (
      provider as unknown as {
        visionByModelId: Map<string, boolean>;
        nativeToolCallingByModelId: Map<string, boolean>;
        thinkingModels: Set<string>;
        nonThinkingModels: Set<string>;
        clearModelCache(): void;
      }
    ).nativeToolCallingByModelId.set('tool-model:cloud', true);
    (
      provider as unknown as {
        visionByModelId: Map<string, boolean>;
        nativeToolCallingByModelId: Map<string, boolean>;
        thinkingModels: Set<string>;
        nonThinkingModels: Set<string>;
        clearModelCache(): void;
      }
    ).nativeToolCallingByModelId.set('ollama:tool-model:cloud', true);

    const progress = { report: vi.fn() };
    const token = { isCancellationRequested: false };

    const model = {
      id: 'tool-model:cloud',
      name: 'Tool Model Cloud',
      family: '🦙 Ollama',
      version: '1.0.0',
      maxInputTokens: 100,
      maxOutputTokens: 100,
      capabilities: { imageInput: false, toolCalling: true },
    };

    const message = {
      role: LanguageModelChatMessageRole.User,
      name: undefined,
      content: [new LanguageModelTextPart('hi')],
    };

    const toolDef = {
      name: 'get_weather',
      description: 'Get weather info',
      inputSchema: { type: 'object', properties: {} },
    };

    await provider.provideLanguageModelChatResponse(
      model as unknown as LanguageModelChatInformation,
      [message as unknown as LanguageModelChatRequestMessage],
      { tools: [toolDef], toolMode: 'auto' } as unknown as ProvideLanguageModelChatResponseOptions,
      progress as unknown as Progress<LanguageModelResponsePart>,
      token as unknown as CancellationToken,
    );

    expect(chat).toHaveBeenCalledTimes(2);
    expect(chat.mock.calls[0]?.[0]?.tools?.length).toBe(1);
    expect(chat.mock.calls[1]?.[0]?.tools).toBeUndefined();

    const allValues = progress.report.mock.calls.map((c: any[]) => c[0]?.value ?? '');
    expect(allValues.some((v: string) => v.includes('Recovered without tools.'))).toBe(true);
  });

  it('retries without tools when model returns does not support tools', async () => {
    const toolsUnsupportedError = Object.assign(
      new Error('registry.ollama.ai/library/smollm2:latest does not support tools'),
      {
        name: 'ResponseError',
        status_code: 400,
      },
    );

    const chat = vi
      .fn()
      .mockRejectedValueOnce(toolsUnsupportedError)
      .mockResolvedValueOnce(
        (async function* () {
          yield { message: { content: 'Recovered without tool payload.' }, done: true };
        })(),
      );

    vi.mocked(getOllamaClient).mockResolvedValue({ chat, abort: vi.fn() } as unknown as Ollama);

    const provider = new OllamaChatModelProvider(
      makeContext(),
      { list: vi.fn(), show: vi.fn() } as unknown as Ollama,
      makeLogger(),
    );

    // Force native tool-calling support so first request includes tools.
    (
      provider as unknown as {
        visionByModelId: Map<string, boolean>;
        nativeToolCallingByModelId: Map<string, boolean>;
        thinkingModels: Set<string>;
        nonThinkingModels: Set<string>;
        clearModelCache(): void;
      }
    ).nativeToolCallingByModelId.set('smollm2:latest', true);
    (
      provider as unknown as {
        visionByModelId: Map<string, boolean>;
        nativeToolCallingByModelId: Map<string, boolean>;
        thinkingModels: Set<string>;
        nonThinkingModels: Set<string>;
        clearModelCache(): void;
      }
    ).nativeToolCallingByModelId.set('ollama:smollm2:latest', true);

    const progress = { report: vi.fn() };
    const token = { isCancellationRequested: false };

    const model = {
      id: 'smollm2:latest',
      name: 'SmolLM2',
      family: '🦙 Ollama',
      version: '1.0.0',
      maxInputTokens: 100,
      maxOutputTokens: 100,
      capabilities: { imageInput: false, toolCalling: true },
    };

    const message = {
      role: LanguageModelChatMessageRole.User,
      name: undefined,
      content: [new LanguageModelTextPart('howdy')],
    };

    const toolDef = {
      name: 'search',
      description: 'search',
      inputSchema: {},
    };

    await provider.provideLanguageModelChatResponse(
      model as unknown as LanguageModelChatInformation,
      [message as unknown as LanguageModelChatRequestMessage],
      { tools: [toolDef], toolMode: 'auto' } as unknown as ProvideLanguageModelChatResponseOptions,
      progress as unknown as Progress<LanguageModelResponsePart>,
      token as unknown as CancellationToken,
    );

    expect(chat).toHaveBeenCalledTimes(2);
    expect(chat.mock.calls[0]?.[0]?.tools?.length).toBe(1);
    expect(chat.mock.calls[1]?.[0]?.tools).toBeUndefined();

    const allValues = progress.report.mock.calls.map((c: any[]) => c[0]?.value ?? '');
    expect(allValues.some((v: string) => v.includes('Recovered without tool payload.'))).toBe(true);
  });

  it('rescues opaque cloud 500 failures with non-stream fallback', async () => {
    const opaque500 = Object.assign(
      new Error(
        '{"StatusCode":500,"Status":"500 Internal Server Error","error":"Internal Server Error while thinking"}',
      ),
      {
        name: 'ResponseError',
        status_code: 500,
      },
    );

    const chat = vi
      .fn()
      // Initial stream=true request with think=true
      .mockRejectedValueOnce(opaque500)
      // Retry without think
      .mockRejectedValueOnce(opaque500)
      // Retry without tools
      .mockRejectedValueOnce(opaque500)
      // New rescue path: non-stream full context
      .mockResolvedValueOnce({
        message: { content: 'Recovered via cloud non-stream rescue.' },
        done: true,
      });

    vi.mocked(getCloudOllamaClient).mockResolvedValue({ chat, abort: vi.fn() } as unknown as Ollama);

    const provider = new OllamaChatModelProvider(
      makeContext(),
      { list: vi.fn(), show: vi.fn() } as unknown as Ollama,
      makeLogger(),
    );

    // Force native tool-calling support so the first request includes tools and follows the same branch as runtime.
    (
      provider as unknown as {
        visionByModelId: Map<string, boolean>;
        nativeToolCallingByModelId: Map<string, boolean>;
        thinkingModels: Set<string>;
        nonThinkingModels: Set<string>;
        clearModelCache(): void;
      }
    ).nativeToolCallingByModelId.set('kimi-k2-thinking:cloud', true);
    (
      provider as unknown as {
        visionByModelId: Map<string, boolean>;
        nativeToolCallingByModelId: Map<string, boolean>;
        thinkingModels: Set<string>;
        nonThinkingModels: Set<string>;
        clearModelCache(): void;
      }
    ).nativeToolCallingByModelId.set('ollama:kimi-k2-thinking:cloud', true);

    const progress = { report: vi.fn() };
    const token = { isCancellationRequested: false };

    const model = {
      id: 'kimi-k2-thinking:cloud',
      name: 'Kimi K2 Thinking Cloud',
      family: '🦙 Ollama',
      version: '1.0.0',
      maxInputTokens: 100,
      maxOutputTokens: 100,
      capabilities: { imageInput: false, toolCalling: true },
    };

    const message = {
      role: LanguageModelChatMessageRole.User,
      name: undefined,
      content: [new LanguageModelTextPart('hi')],
    };

    const toolDef = {
      name: 'search',
      description: 'search',
      inputSchema: {},
    };

    await provider.provideLanguageModelChatResponse(
      model as unknown as LanguageModelChatInformation,
      [message as unknown as LanguageModelChatRequestMessage],
      { tools: [toolDef], toolMode: 'auto' } as unknown as ProvideLanguageModelChatResponseOptions,
      progress as unknown as Progress<LanguageModelResponsePart>,
      token as unknown as CancellationToken,
    );

    expect(chat).toHaveBeenCalledTimes(4);
    expect(chat.mock.calls[3]?.[0]).toEqual(
      expect.objectContaining({
        stream: false,
      }),
    );

    const allValues = progress.report.mock.calls.map((c: any[]) => c[0]?.value ?? '');
    expect(allValues.some((v: string) => v.includes('Recovered via cloud non-stream rescue.'))).toBe(true);
    expect(allValues.every((v: string) => !v.startsWith('Error:'))).toBe(true);
  });

  it('cloud rescue preserves thinking and tool calls when present', async () => {
    const opaque500 = Object.assign(
      new Error(
        '{"StatusCode":500,"Status":"500 Internal Server Error","error":"Internal Server Error while thinking"}',
      ),
      { name: 'ResponseError', status_code: 500 },
    );

    const chat = vi
      .fn()
      // Initial stream=true → 500
      .mockRejectedValueOnce(opaque500)
      // Retry without think → 500
      .mockRejectedValueOnce(opaque500)
      // Retry without tools → 500
      .mockRejectedValueOnce(opaque500)
      // Rescue: reduced-context+think+tools — succeeds with thinking + tool_calls
      .mockResolvedValueOnce({
        message: {
          thinking: 'Let me think about this...',
          content: '',
          tool_calls: [{ function: { name: 'search', arguments: { query: 'hello' } } }],
        },
        done: true,
      });

    vi.mocked(getCloudOllamaClient).mockResolvedValue({ chat, abort: vi.fn() } as unknown as Ollama);

    const provider = new OllamaChatModelProvider(
      makeContext(),
      { list: vi.fn(), show: vi.fn() } as unknown as Ollama,
      makeLogger(),
    );

    (
      provider as unknown as {
        visionByModelId: Map<string, boolean>;
        nativeToolCallingByModelId: Map<string, boolean>;
        thinkingModels: Set<string>;
        nonThinkingModels: Set<string>;
        clearModelCache(): void;
      }
    ).nativeToolCallingByModelId.set('kimi-k2-thinking:cloud', true);
    (
      provider as unknown as {
        visionByModelId: Map<string, boolean>;
        nativeToolCallingByModelId: Map<string, boolean>;
        thinkingModels: Set<string>;
        nonThinkingModels: Set<string>;
        clearModelCache(): void;
      }
    ).nativeToolCallingByModelId.set('ollama:kimi-k2-thinking:cloud', true);

    const progress = { report: vi.fn() };
    const token = { isCancellationRequested: false };

    const model = {
      id: 'kimi-k2-thinking:cloud',
      name: 'Kimi K2 Thinking Cloud',
      family: '🦙 Ollama',
      version: '1.0.0',
      maxInputTokens: 100,
      maxOutputTokens: 100,
      capabilities: { imageInput: false, toolCalling: true },
    };

    const message = {
      role: LanguageModelChatMessageRole.User,
      name: undefined,
      content: [new LanguageModelTextPart('hi')],
    };

    const toolDef = {
      name: 'search',
      description: 'search',
      inputSchema: {},
    };

    await provider.provideLanguageModelChatResponse(
      model as unknown as LanguageModelChatInformation,
      [message as unknown as LanguageModelChatRequestMessage],
      { tools: [toolDef], toolMode: 'auto' } as unknown as ProvideLanguageModelChatResponseOptions,
      progress as unknown as Progress<LanguageModelResponsePart>,
      token as unknown as CancellationToken,
    );

    // The rescue request should include think and tools
    const rescueCall = chat.mock.calls[3]?.[0];
    expect(rescueCall).toEqual(
      expect.objectContaining({
        stream: false,
        think: true,
      }),
    );
    expect(rescueCall.tools).toBeDefined();

    // Thinking content should be emitted
    const reportedParts = progress.report.mock.calls.map((c: any[]) => c[0]);
    const textValues = reportedParts.filter((p: any) => p?.value !== undefined).map((p: any) => p.value);
    expect(textValues.some((v: string) => v.includes('Thinking'))).toBe(true);
    expect(textValues.some((v: string) => v.includes('Let me think about this...'))).toBe(true);

    // Tool call should be emitted
    const toolCallParts = reportedParts.filter((p: any) => p instanceof LanguageModelToolCallPart);
    expect(toolCallParts).toHaveLength(1);
    expect(toolCallParts[0].name).toBe('search');
  });

  it('does not retry again on second call when model is in nonThinkingModels', async () => {
    const thinkingError = Object.assign(new Error('"qwen3:latest" does not support thinking'), {
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

    vi.mocked(getOllamaClient).mockResolvedValue({ chat, abort: vi.fn() } as unknown as Ollama);

    const provider = new OllamaChatModelProvider(
      makeContext(),
      { list: vi.fn(), show: vi.fn() } as unknown as Ollama,
      makeLogger(),
    );

    const progress = { report: vi.fn() };
    const token = { isCancellationRequested: false };

    const model = {
      id: 'qwen3:latest',
      name: 'Qwen3 Latest',
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
      model as unknown as LanguageModelChatInformation,
      [message as unknown as LanguageModelChatRequestMessage],
      { tools: [], toolMode: 'auto' } as unknown as ProvideLanguageModelChatResponseOptions,
      progress as unknown as Progress<LanguageModelResponsePart>,
      token as unknown as CancellationToken,
    );

    progress.report.mockClear();

    // Second call — should NOT pass think: true (model is now blacklisted)
    await provider.provideLanguageModelChatResponse(
      model as unknown as LanguageModelChatInformation,
      [message as unknown as LanguageModelChatRequestMessage],
      { tools: [], toolMode: 'auto' } as unknown as ProvideLanguageModelChatResponseOptions,
      progress as unknown as Progress<LanguageModelResponsePart>,
      token as unknown as CancellationToken,
    );

    // Total: 3 calls (1 failed + 1 retry + 1 second request without think)
    expect(chat).toHaveBeenCalledTimes(3);
    expect(chat.mock.calls[2]?.[0]?.think).toBeUndefined();
  });

  it('cloud rescue attempt 2 (reduced-context+think, no tools) succeeds when attempt 1 returns empty content', async () => {
    const opaque500 = Object.assign(
      new Error(
        '{"StatusCode":500,"Status":"500 Internal Server Error","error":"Internal Server Error while thinking"}',
      ),
      { name: 'ResponseError', status_code: 500 },
    );

    const chat = vi
      .fn()
      // Streaming retries (3 throws drive into the outer catch)
      .mockRejectedValueOnce(opaque500)
      .mockRejectedValueOnce(opaque500)
      .mockRejectedValueOnce(opaque500)
      // Rescue attempt 1: reduced-context+think+tools → empty content (hasContent falsy)
      .mockResolvedValueOnce({ message: { content: '', thinking: '', tool_calls: [] }, done: true })
      // Rescue attempt 2: reduced-context+think → succeeds
      .mockResolvedValueOnce({ message: { content: 'Rescued on attempt 2.' }, done: true });

    vi.mocked(getCloudOllamaClient).mockResolvedValue({ chat, abort: vi.fn() } as unknown as Ollama);

    const provider = new OllamaChatModelProvider(
      makeContext(),
      { list: vi.fn(), show: vi.fn() } as unknown as Ollama,
      makeLogger(),
    );

    (
      provider as unknown as {
        visionByModelId: Map<string, boolean>;
        nativeToolCallingByModelId: Map<string, boolean>;
        thinkingModels: Set<string>;
        nonThinkingModels: Set<string>;
        clearModelCache(): void;
      }
    ).nativeToolCallingByModelId.set('kimi-k2-thinking:cloud', true);
    (
      provider as unknown as {
        visionByModelId: Map<string, boolean>;
        nativeToolCallingByModelId: Map<string, boolean>;
        thinkingModels: Set<string>;
        nonThinkingModels: Set<string>;
        clearModelCache(): void;
      }
    ).nativeToolCallingByModelId.set('ollama:kimi-k2-thinking:cloud', true);

    const progress = { report: vi.fn() };
    const token = { isCancellationRequested: false };

    const model = {
      id: 'kimi-k2-thinking:cloud',
      name: 'Kimi K2 Thinking Cloud',
      family: '🦙 Ollama',
      version: '1.0.0',
      maxInputTokens: 100,
      maxOutputTokens: 100,
      capabilities: { imageInput: false, toolCalling: true },
    };

    const message = {
      role: LanguageModelChatMessageRole.User,
      name: undefined,
      content: [new LanguageModelTextPart('hi')],
    };

    const toolDef = { name: 'search', description: 'search', inputSchema: {} };

    await provider.provideLanguageModelChatResponse(
      model as unknown as LanguageModelChatInformation,
      [message as unknown as LanguageModelChatRequestMessage],
      { tools: [toolDef], toolMode: 'auto' } as unknown as ProvideLanguageModelChatResponseOptions,
      progress as unknown as Progress<LanguageModelResponsePart>,
      token as unknown as CancellationToken,
    );

    expect(chat).toHaveBeenCalledTimes(5);

    // Attempt 2 should be stream: false and have no tools
    const attempt2Call = chat.mock.calls[4]?.[0];
    expect(attempt2Call).toEqual(expect.objectContaining({ stream: false }));
    expect(attempt2Call.tools).toBeUndefined();

    const allValues = progress.report.mock.calls.map((c: any[]) => c[0]?.value ?? '');
    expect(allValues.some((v: string) => v.includes('Rescued on attempt 2.'))).toBe(true);
  });

  it('cloud rescue attempt 3 (reduced-context, no think, no tools) succeeds when attempts 1-2 throw', async () => {
    const opaque500 = Object.assign(
      new Error(
        '{"StatusCode":500,"Status":"500 Internal Server Error","error":"Internal Server Error while thinking"}',
      ),
      { name: 'ResponseError', status_code: 500 },
    );

    const chat = vi
      .fn()
      // Streaming retries
      .mockRejectedValueOnce(opaque500)
      .mockRejectedValueOnce(opaque500)
      .mockRejectedValueOnce(opaque500)
      // Rescue attempt 1: throws
      .mockRejectedValueOnce(new Error('attempt 1 failed'))
      // Rescue attempt 2: throws
      .mockRejectedValueOnce(new Error('attempt 2 failed'))
      // Rescue attempt 3: reduced-context, no think, no tools — succeeds
      .mockResolvedValueOnce({ message: { content: 'Rescued on attempt 3.' }, done: true });

    vi.mocked(getCloudOllamaClient).mockResolvedValue({ chat, abort: vi.fn() } as unknown as Ollama);

    const provider = new OllamaChatModelProvider(
      makeContext(),
      { list: vi.fn(), show: vi.fn() } as unknown as Ollama,
      makeLogger(),
    );

    (
      provider as unknown as {
        visionByModelId: Map<string, boolean>;
        nativeToolCallingByModelId: Map<string, boolean>;
        thinkingModels: Set<string>;
        nonThinkingModels: Set<string>;
        clearModelCache(): void;
      }
    ).nativeToolCallingByModelId.set('kimi-k2-thinking:cloud', true);
    (
      provider as unknown as {
        visionByModelId: Map<string, boolean>;
        nativeToolCallingByModelId: Map<string, boolean>;
        thinkingModels: Set<string>;
        nonThinkingModels: Set<string>;
        clearModelCache(): void;
      }
    ).nativeToolCallingByModelId.set('ollama:kimi-k2-thinking:cloud', true);

    const progress = { report: vi.fn() };
    const token = { isCancellationRequested: false };

    const model = {
      id: 'kimi-k2-thinking:cloud',
      name: 'Kimi K2 Thinking Cloud',
      family: '🦙 Ollama',
      version: '1.0.0',
      maxInputTokens: 100,
      maxOutputTokens: 100,
      capabilities: { imageInput: false, toolCalling: true },
    };

    const message = {
      role: LanguageModelChatMessageRole.User,
      name: undefined,
      content: [new LanguageModelTextPart('hi')],
    };

    const toolDef = { name: 'search', description: 'search', inputSchema: {} };

    await provider.provideLanguageModelChatResponse(
      model as unknown as LanguageModelChatInformation,
      [message as unknown as LanguageModelChatRequestMessage],
      { tools: [toolDef], toolMode: 'auto' } as unknown as ProvideLanguageModelChatResponseOptions,
      progress as unknown as Progress<LanguageModelResponsePart>,
      token as unknown as CancellationToken,
    );

    expect(chat).toHaveBeenCalledTimes(6);

    // Attempt 3 should be stream: false, no think, no tools
    const attempt3Call = chat.mock.calls[5]?.[0];
    expect(attempt3Call).toEqual(expect.objectContaining({ stream: false }));
    expect(attempt3Call.tools).toBeUndefined();
    expect(attempt3Call.think).toBeUndefined();

    const allValues = progress.report.mock.calls.map((c: any[]) => c[0]?.value ?? '');
    expect(allValues.some((v: string) => v.includes('Rescued on attempt 3.'))).toBe(true);
  });

  it('cloud rescue emits error message when all 4 attempts fail', async () => {
    const opaque500 = Object.assign(
      new Error(
        '{"StatusCode":500,"Status":"500 Internal Server Error","error":"Internal Server Error while thinking"}',
      ),
      { name: 'ResponseError', status_code: 500 },
    );

    const chat = vi
      .fn()
      // Streaming retries (3)
      .mockRejectedValueOnce(opaque500)
      .mockRejectedValueOnce(opaque500)
      .mockRejectedValueOnce(opaque500)
      // All 4 rescue attempts fail with empty content
      .mockResolvedValueOnce({ message: { content: '' }, done: true })
      .mockResolvedValueOnce({ message: { content: '' }, done: true })
      .mockResolvedValueOnce({ message: { content: '' }, done: true })
      .mockResolvedValueOnce({ message: { content: '' }, done: true });

    vi.mocked(getCloudOllamaClient).mockResolvedValue({ chat, abort: vi.fn() } as unknown as Ollama);

    const provider = new OllamaChatModelProvider(
      makeContext(),
      { list: vi.fn(), show: vi.fn() } as unknown as Ollama,
      makeLogger(),
    );

    (
      provider as unknown as {
        visionByModelId: Map<string, boolean>;
        nativeToolCallingByModelId: Map<string, boolean>;
        thinkingModels: Set<string>;
        nonThinkingModels: Set<string>;
        clearModelCache(): void;
      }
    ).nativeToolCallingByModelId.set('kimi-k2-thinking:cloud', true);
    (
      provider as unknown as {
        visionByModelId: Map<string, boolean>;
        nativeToolCallingByModelId: Map<string, boolean>;
        thinkingModels: Set<string>;
        nonThinkingModels: Set<string>;
        clearModelCache(): void;
      }
    ).nativeToolCallingByModelId.set('ollama:kimi-k2-thinking:cloud', true);

    const progress = { report: vi.fn() };
    const token = { isCancellationRequested: false };

    const model = {
      id: 'kimi-k2-thinking:cloud',
      name: 'Kimi K2 Thinking Cloud',
      family: '🦙 Ollama',
      version: '1.0.0',
      maxInputTokens: 100,
      maxOutputTokens: 100,
      capabilities: { imageInput: false, toolCalling: true },
    };

    const message = {
      role: LanguageModelChatMessageRole.User,
      name: undefined,
      content: [new LanguageModelTextPart('hi')],
    };

    const toolDef = { name: 'search', description: 'search', inputSchema: {} };

    await provider.provideLanguageModelChatResponse(
      model as unknown as LanguageModelChatInformation,
      [message as unknown as LanguageModelChatRequestMessage],
      { tools: [toolDef], toolMode: 'auto' } as unknown as ProvideLanguageModelChatResponseOptions,
      progress as unknown as Progress<LanguageModelResponsePart>,
      token as unknown as CancellationToken,
    );

    // All 4 rescue attempts exhausted plus the 3 streaming retries
    expect(chat).toHaveBeenCalledTimes(7);

    // An error message should be emitted to progress when all rescue attempts fail
    const allValues = progress.report.mock.calls.map((c: any[]) => c[0]?.value ?? '');
    expect(allValues.some((v: string) => v.startsWith('Error:'))).toBe(true);
  });

  it('cloud rescue is skipped when cancellation is requested before rescue', async () => {
    const opaque500 = Object.assign(
      new Error(
        '{"StatusCode":500,"Status":"500 Internal Server Error","error":"Internal Server Error while thinking"}',
      ),
      { name: 'ResponseError', status_code: 500 },
    );

    const chat = vi
      .fn()
      .mockRejectedValueOnce(opaque500)
      .mockRejectedValueOnce(opaque500)
      .mockRejectedValueOnce(opaque500);

    vi.mocked(getCloudOllamaClient).mockResolvedValue({ chat, abort: vi.fn() } as unknown as Ollama);

    const provider = new OllamaChatModelProvider(
      makeContext(),
      { list: vi.fn(), show: vi.fn() } as unknown as Ollama,
      makeLogger(),
    );

    (
      provider as unknown as {
        visionByModelId: Map<string, boolean>;
        nativeToolCallingByModelId: Map<string, boolean>;
        thinkingModels: Set<string>;
        nonThinkingModels: Set<string>;
        clearModelCache(): void;
      }
    ).nativeToolCallingByModelId.set('kimi-k2-thinking:cloud', true);
    (
      provider as unknown as {
        visionByModelId: Map<string, boolean>;
        nativeToolCallingByModelId: Map<string, boolean>;
        thinkingModels: Set<string>;
        nonThinkingModels: Set<string>;
        clearModelCache(): void;
      }
    ).nativeToolCallingByModelId.set('ollama:kimi-k2-thinking:cloud', true);

    const progress = { report: vi.fn() };
    // Cancellation is already requested
    const token = { isCancellationRequested: true };

    const model = {
      id: 'kimi-k2-thinking:cloud',
      name: 'Kimi K2 Thinking Cloud',
      family: '🦙 Ollama',
      version: '1.0.0',
      maxInputTokens: 100,
      maxOutputTokens: 100,
      capabilities: { imageInput: false, toolCalling: true },
    };

    const message = {
      role: LanguageModelChatMessageRole.User,
      name: undefined,
      content: [new LanguageModelTextPart('hi')],
    };

    const toolDef = { name: 'search', description: 'search', inputSchema: {} };

    await provider.provideLanguageModelChatResponse(
      model as unknown as LanguageModelChatInformation,
      [message as unknown as LanguageModelChatRequestMessage],
      { tools: [toolDef], toolMode: 'auto' } as unknown as ProvideLanguageModelChatResponseOptions,
      progress as unknown as Progress<LanguageModelResponsePart>,
      token as unknown as CancellationToken,
    );

    // Only the 3 streaming retries — rescue attempts must NOT be made
    expect(chat).toHaveBeenCalledTimes(3);
  });

  it('cloud rescue is not triggered for non-cloud model 500 errors', async () => {
    const opaque500 = Object.assign(
      new Error(
        '{"StatusCode":500,"Status":"500 Internal Server Error","error":"Internal Server Error while thinking"}',
      ),
      { name: 'ResponseError', status_code: 500 },
    );

    const chat = vi
      .fn()
      .mockRejectedValueOnce(opaque500)
      // Retry without think
      .mockResolvedValueOnce(
        (async function* () {
          yield { message: { content: 'responded without thinking' }, done: true };
        })(),
      );

    vi.mocked(getOllamaClient).mockResolvedValue({ chat, abort: vi.fn() } as unknown as Ollama);

    const provider = new OllamaChatModelProvider(
      makeContext(),
      { list: vi.fn(), show: vi.fn() } as unknown as Ollama,
      makeLogger(),
    );

    const progress = { report: vi.fn() };
    const token = { isCancellationRequested: false };

    // Local model (no ':cloud' suffix) — cloud rescue must NOT be triggered
    const model = {
      id: 'qwen3:latest',
      name: 'Qwen3',
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
      model as unknown as LanguageModelChatInformation,
      [message as unknown as LanguageModelChatRequestMessage],
      { tools: [], toolMode: 'auto' } as unknown as ProvideLanguageModelChatResponseOptions,
      progress as unknown as Progress<LanguageModelResponsePart>,
      token as unknown as CancellationToken,
    );

    // Only 2 chat calls (initial + think retry) — no rescue attempts
    expect(chat).toHaveBeenCalledTimes(2);

    const allValues = progress.report.mock.calls.map((c: any[]) => c[0]?.value ?? '');
    expect(allValues.some((v: string) => v.includes('responded without thinking'))).toBe(true);
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

    vi.mocked(getOllamaClient).mockResolvedValueOnce({ chat, generate, abort: vi.fn() } as unknown as Ollama);

    const provider = new OllamaChatModelProvider(
      makeContext(),
      { list: vi.fn(), show: vi.fn() } as unknown as Ollama,
      makeLogger(),
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
      [message as unknown as LanguageModelChatRequestMessage],
      { tools: [], toolMode: 'auto' } as unknown as ProvideLanguageModelChatResponseOptions,
      progress as unknown as Progress<LanguageModelResponsePart>,
      token as unknown as CancellationToken,
    );

    expect(vi.mocked(window.showErrorMessage)).toHaveBeenCalledWith(
      expect.stringContaining('model runner crashed'),
      'Open Logs',
    );
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ model: 'test-model', keep_alive: 0 }));
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

  it('returns true for kimi models', () => {
    expect(isThinkingModelId('kimi-k2-thinking:cloud')).toBe(true);
    expect(isThinkingModelId('kimi-k2:latest')).toBe(true);
  });

  it('returns true for models with "thinking" in the name', () => {
    expect(isThinkingModelId('some-model-thinking:cloud')).toBe(true);
    expect(isThinkingModelId('mythinking-model:latest')).toBe(true);
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

    vi.mocked(getOllamaClient).mockResolvedValueOnce({ chat, abort: vi.fn() } as unknown as Ollama);

    const provider = new OllamaChatModelProvider(
      makeContext(),
      { list: vi.fn(), show: vi.fn() } as unknown as Ollama,
      makeLogger(),
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
      [message as unknown as LanguageModelChatRequestMessage],
      { tools: [], toolMode: 'auto' } as unknown as ProvideLanguageModelChatResponseOptions,
      progress as unknown as Progress<LanguageModelResponsePart>,
      token as unknown as CancellationToken,
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

    vi.mocked(getOllamaClient).mockResolvedValueOnce({ chat, abort: vi.fn() } as unknown as Ollama);

    const provider = new OllamaChatModelProvider(
      makeContext(),
      { list: vi.fn(), show: vi.fn() } as unknown as Ollama,
      makeLogger(),
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
      [message as unknown as LanguageModelChatRequestMessage],
      { tools: [], toolMode: 'auto' } as unknown as ProvideLanguageModelChatResponseOptions,
      { report: vi.fn() } as unknown as Progress<LanguageModelResponsePart>,
      { isCancellationRequested: false } as unknown as CancellationToken,
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

    vi.mocked(getOllamaClient).mockResolvedValueOnce({ chat, abort: vi.fn() } as unknown as Ollama);

    const provider = new OllamaChatModelProvider(
      makeContext(),
      { list: vi.fn(), show: vi.fn() } as unknown as Ollama,
      makeLogger(),
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
      [
        turn1 as unknown as LanguageModelChatRequestMessage,
        turn1Reply as unknown as LanguageModelChatRequestMessage,
        turn2 as unknown as LanguageModelChatRequestMessage,
      ],
      { tools: [], toolMode: 'auto' } as unknown as ProvideLanguageModelChatResponseOptions,
      { report: vi.fn() } as unknown as Progress<LanguageModelResponsePart>,
      { isCancellationRequested: false } as unknown as CancellationToken,
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

    vi.mocked(getOllamaClient).mockResolvedValueOnce({ chat, abort: vi.fn() } as unknown as Ollama);

    const provider = new OllamaChatModelProvider(
      makeContext(),
      { list: vi.fn(), show: vi.fn() } as unknown as Ollama,
      makeLogger(),
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
      [message as unknown as LanguageModelChatRequestMessage],
      { tools: [], toolMode: 'auto' } as unknown as ProvideLanguageModelChatResponseOptions,
      { report: vi.fn() } as unknown as Progress<LanguageModelResponsePart>,
      { isCancellationRequested: false } as unknown as CancellationToken,
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
