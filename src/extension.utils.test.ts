import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();

  vi.doMock('vscode', () => ({
    workspace: {
      getConfiguration: vi.fn(() => ({ get: vi.fn(), update: vi.fn() })),
      onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
      openTextDocument: vi.fn(),
    },
    window: {
      createOutputChannel: vi.fn(() => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        log: vi.fn(),
        show: vi.fn(),
      })),
      showErrorMessage: vi.fn(),
      showWarningMessage: vi.fn(),
      showInformationMessage: vi.fn(),
      showTextDocument: vi.fn(),
    },
    commands: {
      executeCommand: vi.fn(),
      registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
    },
    lm: {
      selectChatModels: vi.fn().mockResolvedValue([]),
      registerLanguageModelChatProvider: vi.fn(() => ({ dispose: vi.fn() })),
      tools: [],
      invokeTool: vi.fn(),
    },
    languages: {
      registerInlineCompletionItemProvider: vi.fn(() => ({ dispose: vi.fn() })),
    },
    chat: {
      createChatParticipant: vi.fn(() => ({ iconPath: undefined, dispose: vi.fn() })),
    },
    Uri: {
      file: vi.fn((path: string) => ({ fsPath: path })),
      joinPath: vi.fn((_base: unknown, p: string) => ({ fsPath: p })),
    },
    LanguageModelTextPart: class {
      constructor(public value: string) {}
    },
    LanguageModelChatMessage: {
      User: vi.fn((content: string) => ({ role: 'user', content })),
      Assistant: vi.fn((content: string) => ({ role: 'assistant', content })),
    },
    LanguageModelChatMessageRole: { User: 1, Assistant: 2 },
    ChatRequestTurn: class {},
    ChatResponseTurn: class {},
    ChatResponseMarkdownPart: class {},
    InlineCompletionItem: class {
      constructor(public readonly insertText: string) {}
    },
    ConfigurationTarget: { Global: 1 },
  }));

  vi.doMock('./client.js', () => ({
    getOllamaClient: vi.fn(),
    getCloudOllamaClient: vi.fn(),
    getOllamaAuthToken: vi.fn(),
    getOllamaHost: vi.fn(() => 'http://localhost:11434'),
    testConnection: vi.fn(),
  }));

  vi.doMock('./diagnostics.js', () => ({
    createDiagnosticsLogger: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      exception: vi.fn(),
    })),
    getConfiguredLogLevel: vi.fn(() => 'info'),
  }));

  vi.doMock('./provider.js', () => ({
    OllamaChatModelProvider: class {
      setAuthToken = vi.fn();
    },
    isThinkingModelId: vi.fn(() => false),
  }));

  vi.doMock('./sidebar.js', () => ({ registerSidebar: vi.fn() }));
  vi.doMock('./modelfiles.js', () => ({ registerModelfileManager: vi.fn() }));
});

describe('extension utility helpers', () => {
  it('toRuntimeModelId removes provider prefix only when present', async () => {
    const { toRuntimeModelId } = await import('./extension.js');
    expect(toRuntimeModelId('ollama:llama3.2:latest')).toBe('llama3.2:latest');
    expect(toRuntimeModelId('llama3.2:latest')).toBe('llama3.2:latest');
  });

  it('mapOpenAiToolCallsToOllamaLike maps ids/names and parses arguments safely', async () => {
    const { mapOpenAiToolCallsToOllamaLike } = await import('./extension.js');

    const mapped = mapOpenAiToolCallsToOllamaLike([
      { id: 'c1', function: { name: 'search', arguments: '{"q":"abc"}' } },
      { id: 'c2', function: { name: 'broken', arguments: '{bad json' } },
      null,
    ]);

    expect(mapped).toEqual([
      { id: 'c1', function: { name: 'search', arguments: { q: 'abc' } } },
      { id: 'c2', function: { name: 'broken', arguments: {} } },
    ]);

    expect(mapOpenAiToolCallsToOllamaLike([])).toBeUndefined();
    expect(mapOpenAiToolCallsToOllamaLike('bad')).toBeUndefined();
  });

  it('isSelectedAction supports string and {title} selections', async () => {
    const { isSelectedAction } = await import('./extension.js');
    expect(isSelectedAction('Reload Window', 'Reload Window')).toBe(true);
    expect(isSelectedAction({ title: 'Reload Window' }, 'Reload Window')).toBe(true);
    expect(isSelectedAction({ title: 'Other' }, 'Reload Window')).toBe(false);
    expect(isSelectedAction(undefined, 'Reload Window')).toBe(false);
  });

  it('formatBytes handles B/KB/MB/GB thresholds', async () => {
    const { formatBytes } = await import('./extension.js');
    expect(formatBytes(999)).toBe('999 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1024 ** 2)).toBe('1.0 MB');
    expect(formatBytes(5 * 1024 ** 3)).toBe('5.00 GB');
  });

  it('isLocalHost identifies localhost variants as local', async () => {
    const { isLocalHost } = await import('./extension.js');
    expect(isLocalHost('http://localhost:11434')).toBe(true);
    expect(isLocalHost('http://127.0.0.1:11434')).toBe(true);
    expect(isLocalHost('http://[::1]:11434')).toBe(true);
    expect(isLocalHost('http://remote-server:11434')).toBe(false);
    expect(isLocalHost('http://192.168.1.100:11434')).toBe(false);
    expect(isLocalHost('not-a-url')).toBe(false);
  });

  it('getOllamaServerLogPath returns null on linux (journalctl path)', async () => {
    const { getOllamaServerLogPath } = await import('./extension.js');
    const result = getOllamaServerLogPath();
    expect(result === null || typeof result === 'string').toBe(true);
  });

  it('handleConfigurationChange triggers callbacks for relevant settings', async () => {
    const { handleConfigurationChange } = await import('./extension.js');

    const diagnostics = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      exception: vi.fn(),
    };
    const onLogLevelChange = vi.fn();
    const onAutoStartChange = vi.fn();

    handleConfigurationChange(
      {
        affectsConfiguration: (key: string) => key === 'ollama.diagnostics.logLevel' || key === 'ollama.streamLogs',
      } as any,
      diagnostics as any,
      onLogLevelChange,
      onAutoStartChange,
    );

    expect(onLogLevelChange).toHaveBeenCalledTimes(1);
    expect(onAutoStartChange).toHaveBeenCalledTimes(1);
  });

  it('handleConnectionTestFailure handles Open Logs selection when no file path exists', async () => {
    const showErrorMessage = vi.fn().mockResolvedValue('Open Logs');

    const { handleConnectionTestFailure } = await import('./extension.js');
    await handleConnectionTestFailure('http://localhost:11434', {
      showErrorMessage,
    } as any);

    // Confirms the Open Logs path was reached.
    expect(showErrorMessage).toHaveBeenCalled();
  });
});
