import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('activate', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('registers language model provider during activation', async () => {
    const registerLanguageModelChatProvider = vi.fn(() => ({ dispose: vi.fn() }));

    vi.doMock('vscode', () => ({
      TreeItem: class {
        constructor(public label: string) {}
      },
      TreeItemCollapsibleState: {
        None: 0,
        Collapsed: 1,
        Expanded: 2,
      },
      EventEmitter: class {
        event = {};
        fire = vi.fn();
      },
      window: {
        registerTreeDataProvider: vi.fn(() => ({ dispose: vi.fn() })),
        registerWebviewViewProvider: vi.fn(() => ({ dispose: vi.fn() })),
        createOutputChannel: vi.fn(() => ({
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          debug: vi.fn(),
          log: vi.fn(),
          show: vi.fn(),
        })),
        showInputBox: vi.fn(),
        showErrorMessage: vi.fn(),
        showInformationMessage: vi.fn(),
        withProgress: vi.fn(async (_options: any, callback: any) => callback({})),
      },
      commands: {
        registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
        executeCommand: vi.fn(),
      },
      workspace: {
        getConfiguration: vi.fn(() => ({
          get: vi.fn((key: string) => {
            if (key === 'autoStartLogStreaming') return false;
            if (key === 'localModelRefreshInterval') return 0;
            if (key === 'libraryRefreshInterval') return 0;
            return undefined;
          }),
        })),
        onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
      },
      lm: {
        registerLanguageModelChatProvider,
      },
      chat: {
        createChatParticipant: vi.fn(() => ({
          iconPath: undefined,
          dispose: vi.fn(),
        })),
      },
      Uri: {
        joinPath: vi.fn((_base: any, _path: string) => ({ fsPath: _path })),
      },
      ChatResponseMarkdownPart: class {
        value: any = {};
      },
      LanguageModelChatMessage: {
        User: vi.fn(),
        Assistant: vi.fn(),
      },
      LanguageModelTextPart: class {},
      CancellationToken: class {},
    }));

    vi.doMock('./client.js', () => ({
      getOllamaClient: vi.fn().mockResolvedValue({
        list: vi.fn().mockResolvedValue({ models: [] }),
        ps: vi.fn().mockResolvedValue({ models: [] }),
        show: vi.fn().mockResolvedValue({ template: '' }),
      }),
      testConnection: vi.fn().mockResolvedValue(true),
    }));

    vi.doMock('./provider.js', () => ({
      OllamaChatModelProvider: class {
        setAuthToken = vi.fn();
      },
    }));

    vi.doMock('./sidebar.js', () => ({
      registerSidebar: vi.fn(),
    }));

    vi.doMock('./modelfiles.js', () => ({
      registerModelfileManager: vi.fn(),
    }));

    const ext = await import('./extension.js');
    await ext.activate({ subscriptions: [], extensionUri: {} } as any);

    expect(registerLanguageModelChatProvider).toHaveBeenCalledWith('selfagency-ollama', expect.anything());
  });

  it('does not throw when provider vendor is already registered', async () => {
    const duplicateError = new Error('Chat model provider for vendor ollama is already registered.');
    const registerLanguageModelChatProvider = vi.fn(() => {
      throw duplicateError;
    });

    vi.doMock('vscode', () => ({
      TreeItem: class {
        constructor(public label: string) {}
      },
      TreeItemCollapsibleState: {
        None: 0,
        Collapsed: 1,
        Expanded: 2,
      },
      EventEmitter: class {
        event = {};
        fire = vi.fn();
      },
      window: {
        registerTreeDataProvider: vi.fn(() => ({ dispose: vi.fn() })),
        registerWebviewViewProvider: vi.fn(() => ({ dispose: vi.fn() })),
        createOutputChannel: vi.fn(() => ({
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          debug: vi.fn(),
          log: vi.fn(),
          show: vi.fn(),
        })),
        showInputBox: vi.fn(),
        showErrorMessage: vi.fn(),
        showInformationMessage: vi.fn(),
        withProgress: vi.fn(async (_options: any, callback: any) => callback({})),
      },
      commands: {
        registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
        executeCommand: vi.fn(),
      },
      workspace: {
        getConfiguration: vi.fn(() => ({
          get: vi.fn((key: string) => {
            if (key === 'autoStartLogStreaming') return false;
            if (key === 'localModelRefreshInterval') return 0;
            if (key === 'libraryRefreshInterval') return 0;
            return undefined;
          }),
        })),
        onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
      },
      lm: {
        registerLanguageModelChatProvider,
      },
      chat: {
        createChatParticipant: vi.fn(() => ({
          iconPath: undefined,
          dispose: vi.fn(),
        })),
      },
      Uri: {
        joinPath: vi.fn((_base: any, _path: string) => ({ fsPath: _path })),
      },
      ChatResponseMarkdownPart: class {
        value: any = {};
      },
      LanguageModelChatMessage: {
        User: vi.fn(),
        Assistant: vi.fn(),
      },
      LanguageModelTextPart: class {},
      CancellationToken: class {},
    }));

    vi.doMock('./client.js', () => ({
      getOllamaClient: vi.fn().mockResolvedValue({
        list: vi.fn().mockResolvedValue({ models: [] }),
        ps: vi.fn().mockResolvedValue({ models: [] }),
        show: vi.fn().mockResolvedValue({ template: '' }),
      }),
      testConnection: vi.fn().mockResolvedValue(true),
    }));

    vi.doMock('./provider.js', () => ({
      OllamaChatModelProvider: class {
        setAuthToken = vi.fn();
      },
    }));

    vi.doMock('./sidebar.js', () => ({
      registerSidebar: vi.fn(),
    }));

    vi.doMock('./modelfiles.js', () => ({
      registerModelfileManager: vi.fn(),
    }));

    const ext = await import('./extension.js');

    await expect(ext.activate({ subscriptions: [], extensionUri: {} } as any)).resolves.toBeUndefined();
  });

  it('handles connection test success', async () => {
    const testConnection = vi.fn().mockResolvedValue(true);
    const mockDiagnostics = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      exception: vi.fn(),
    };
    const createDiagnosticsLogger = vi.fn().mockReturnValue(mockDiagnostics);

    vi.doMock('vscode', () => ({
      TreeItem: class {
        constructor(public label: string) {}
      },
      TreeItemCollapsibleState: {
        None: 0,
        Collapsed: 1,
        Expanded: 2,
      },
      EventEmitter: class {
        event = {};
        fire = vi.fn();
      },
      window: {
        registerTreeDataProvider: vi.fn(() => ({ dispose: vi.fn() })),
        registerWebviewViewProvider: vi.fn(() => ({ dispose: vi.fn() })),
        createOutputChannel: vi.fn(() => ({
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          debug: vi.fn(),
          log: vi.fn(),
          show: vi.fn(),
        })),
        showInputBox: vi.fn(),
        showErrorMessage: vi.fn(),
        showInformationMessage: vi.fn(),
        withProgress: vi.fn(async (_options: any, callback: any) => callback({})),
      },
      commands: {
        registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
        executeCommand: vi.fn(),
      },
      workspace: {
        getConfiguration: vi.fn(() => ({
          get: vi.fn((key: string) => {
            if (key === 'autoStartLogStreaming') return false;
            if (key === 'localModelRefreshInterval') return 0;
            if (key === 'libraryRefreshInterval') return 0;
            return undefined;
          }),
        })),
        onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
      },
      lm: {
        registerLanguageModelChatProvider: vi.fn(() => ({ dispose: vi.fn() })),
      },
      chat: {
        createChatParticipant: vi.fn(() => ({
          iconPath: undefined,
          dispose: vi.fn(),
        })),
      },
      Uri: {
        joinPath: vi.fn((_base: any, _path: string) => ({ fsPath: _path })),
      },
      ChatResponseMarkdownPart: class {
        value: any = {};
      },
      LanguageModelChatMessage: {
        User: vi.fn(),
        Assistant: vi.fn(),
      },
      LanguageModelTextPart: class {},
      CancellationToken: class {},
    }));

    vi.doMock('./client.js', () => ({
      getOllamaClient: vi.fn().mockResolvedValue({
        list: vi.fn().mockResolvedValue({ models: [] }),
        ps: vi.fn().mockResolvedValue({ models: [] }),
        show: vi.fn().mockResolvedValue({ template: '' }),
      }),
      testConnection,
    }));

    vi.doMock('./diagnostics.js', () => ({
      createDiagnosticsLogger,
      getConfiguredLogLevel: vi.fn(() => 'info'),
    }));

    vi.doMock('./provider.js', () => ({
      OllamaChatModelProvider: class {
        setAuthToken = vi.fn();
      },
    }));

    vi.doMock('./sidebar.js', () => ({
      registerSidebar: vi.fn(),
    }));

    vi.doMock('./modelfiles.js', () => ({
      registerModelfileManager: vi.fn(),
    }));

    const ext = await import('./extension.js');
    await ext.activate({ subscriptions: [], extensionUri: {} } as any);

    // Wait for async connection test
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(testConnection).toHaveBeenCalled();
    expect(mockDiagnostics.info).toHaveBeenCalledWith(expect.stringContaining('Connection test'));
  });

  it('handles connection test failure', async () => {
    const testConnection = vi.fn().mockResolvedValue(false);
    const mockDiagnostics = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      exception: vi.fn(),
    };
    const createDiagnosticsLogger = vi.fn().mockReturnValue(mockDiagnostics);
    const showErrorMessage = vi.fn().mockResolvedValue('Open Settings');
    const executeCommand = vi.fn().mockResolvedValue(undefined);

    vi.doMock('vscode', () => ({
      TreeItem: class {
        constructor(public label: string) {}
      },
      TreeItemCollapsibleState: {
        None: 0,
        Collapsed: 1,
        Expanded: 2,
      },
      EventEmitter: class {
        event = {};
        fire = vi.fn();
      },
      window: {
        registerTreeDataProvider: vi.fn(() => ({ dispose: vi.fn() })),
        registerWebviewViewProvider: vi.fn(() => ({ dispose: vi.fn() })),
        createOutputChannel: vi.fn(() => ({
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          debug: vi.fn(),
          log: vi.fn(),
          show: vi.fn(),
        })),
        showInputBox: vi.fn(),
        showErrorMessage,
        showInformationMessage: vi.fn(),
        withProgress: vi.fn(async (_options: any, callback: any) => callback({})),
      },
      commands: {
        registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
        executeCommand,
      },
      workspace: {
        getConfiguration: vi.fn(() => ({
          get: vi.fn((key: string) => {
            if (key === 'autoStartLogStreaming') return false;
            if (key === 'localModelRefreshInterval') return 0;
            if (key === 'libraryRefreshInterval') return 0;
            if (key === 'host') return 'http://localhost:11434';
            return undefined;
          }),
        })),
        onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
      },
      lm: {
        registerLanguageModelChatProvider: vi.fn(() => ({ dispose: vi.fn() })),
      },
      chat: {
        createChatParticipant: vi.fn(() => ({
          iconPath: undefined,
          dispose: vi.fn(),
        })),
      },
      Uri: {
        joinPath: vi.fn((_base: any, _path: string) => ({ fsPath: _path })),
      },
      ChatResponseMarkdownPart: class {
        value: any = {};
      },
      LanguageModelChatMessage: {
        User: vi.fn(),
        Assistant: vi.fn(),
      },
      LanguageModelTextPart: class {},
      CancellationToken: class {},
    }));

    vi.doMock('./client.js', () => ({
      getOllamaClient: vi.fn().mockResolvedValue({
        list: vi.fn().mockResolvedValue({ models: [] }),
        ps: vi.fn().mockResolvedValue({ models: [] }),
        show: vi.fn().mockResolvedValue({ template: '' }),
      }),
      testConnection,
    }));

    vi.doMock('./diagnostics.js', () => ({
      createDiagnosticsLogger,
      getConfiguredLogLevel: vi.fn(() => 'info'),
    }));

    vi.doMock('./provider.js', () => ({
      OllamaChatModelProvider: class {
        setAuthToken = vi.fn();
      },
    }));

    vi.doMock('./sidebar.js', () => ({
      registerSidebar: vi.fn(),
    }));

    vi.doMock('./modelfiles.js', () => ({
      registerModelfileManager: vi.fn(),
    }));

    const ext = await import('./extension.js');
    await ext.activate({ subscriptions: [], extensionUri: {} } as any);

    // Wait for async connection test
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(showErrorMessage).toHaveBeenCalled();
    expect(executeCommand).toHaveBeenCalledWith('workbench.action.openSettings', 'ollama');
  });

  it('enables log streaming on autoStartLogStreaming true', async () => {
    const createOutputChannel = vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      log: vi.fn(),
      show: vi.fn(),
    }));

    vi.doMock('vscode', () => ({
      TreeItem: class {
        constructor(public label: string) {}
      },
      TreeItemCollapsibleState: {
        None: 0,
        Collapsed: 1,
        Expanded: 2,
      },
      EventEmitter: class {
        event = {};
        fire = vi.fn();
      },
      window: {
        registerTreeDataProvider: vi.fn(() => ({ dispose: vi.fn() })),
        registerWebviewViewProvider: vi.fn(() => ({ dispose: vi.fn() })),
        createOutputChannel,
        showInputBox: vi.fn(),
        showErrorMessage: vi.fn(),
        showInformationMessage: vi.fn(),
        withProgress: vi.fn(async (_options: any, callback: any) => callback({})),
      },
      commands: {
        registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
        executeCommand: vi.fn(),
      },
      workspace: {
        getConfiguration: vi.fn(() => ({
          get: vi.fn((key: string) => {
            if (key === 'autoStartLogStreaming') return true;
            if (key === 'localModelRefreshInterval') return 0;
            if (key === 'libraryRefreshInterval') return 0;
            return undefined;
          }),
        })),
        onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
      },
      lm: {
        registerLanguageModelChatProvider: vi.fn(() => ({ dispose: vi.fn() })),
      },
      chat: {
        createChatParticipant: vi.fn(() => ({
          iconPath: undefined,
          dispose: vi.fn(),
        })),
      },
      Uri: {
        joinPath: vi.fn((_base: any, _path: string) => ({ fsPath: _path })),
      },
      ChatResponseMarkdownPart: class {
        value: any = {};
      },
      LanguageModelChatMessage: {
        User: vi.fn(),
        Assistant: vi.fn(),
      },
      LanguageModelTextPart: class {},
      CancellationToken: class {},
    }));

    vi.doMock('./client.js', () => ({
      getOllamaClient: vi.fn().mockResolvedValue({
        list: vi.fn().mockResolvedValue({ models: [] }),
        ps: vi.fn().mockResolvedValue({ models: [] }),
        show: vi.fn().mockResolvedValue({ template: '' }),
      }),
      testConnection: vi.fn().mockResolvedValue(true),
    }));

    vi.doMock('./diagnostics.js', () => ({
      createDiagnosticsLogger: vi.fn(output => ({
        info: output.info,
        warn: output.warn,
        error: output.error,
        debug: output.debug,
        exception: vi.fn(),
      })),
      getConfiguredLogLevel: vi.fn(() => 'info'),
    }));

    vi.doMock('./provider.js', () => ({
      OllamaChatModelProvider: class {
        setAuthToken = vi.fn();
      },
    }));

    vi.doMock('./sidebar.js', () => ({
      registerSidebar: vi.fn(),
    }));

    vi.doMock('./modelfiles.js', () => ({
      registerModelfileManager: vi.fn(),
    }));

    const ext = await import('./extension.js');
    await ext.activate({ subscriptions: [], extensionUri: {} } as any);

    expect(createOutputChannel).toHaveBeenCalledWith('Ollama for Copilot', expect.any(Object));
  });

  it('throws on unhandled registration error', async () => {
    const unhandledError = new Error('Unexpected registration error');
    const registerLanguageModelChatProvider = vi.fn(() => {
      throw unhandledError;
    });

    vi.doMock('vscode', () => ({
      TreeItem: class {
        constructor(public label: string) {}
      },
      TreeItemCollapsibleState: {
        None: 0,
        Collapsed: 1,
        Expanded: 2,
      },
      EventEmitter: class {
        event = {};
        fire = vi.fn();
      },
      window: {
        registerTreeDataProvider: vi.fn(() => ({ dispose: vi.fn() })),
        registerWebviewViewProvider: vi.fn(() => ({ dispose: vi.fn() })),
        createOutputChannel: vi.fn(() => ({
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          debug: vi.fn(),
          log: vi.fn(),
          show: vi.fn(),
        })),
        showInputBox: vi.fn(),
        showErrorMessage: vi.fn(),
        showInformationMessage: vi.fn(),
        withProgress: vi.fn(async (_options: any, callback: any) => callback({})),
      },
      commands: {
        registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
        executeCommand: vi.fn(),
      },
      workspace: {
        getConfiguration: vi.fn(() => ({
          get: vi.fn((key: string) => {
            if (key === 'autoStartLogStreaming') return false;
            if (key === 'localModelRefreshInterval') return 0;
            if (key === 'libraryRefreshInterval') return 0;
            return undefined;
          }),
        })),
        onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
      },
      lm: {
        registerLanguageModelChatProvider,
      },
      chat: {
        createChatParticipant: vi.fn(() => ({
          iconPath: undefined,
          dispose: vi.fn(),
        })),
      },
      Uri: {
        joinPath: vi.fn((_base: any, _path: string) => ({ fsPath: _path })),
      },
      ChatResponseMarkdownPart: class {
        value: any = {};
      },
      LanguageModelChatMessage: {
        User: vi.fn(),
        Assistant: vi.fn(),
      },
      LanguageModelTextPart: class {},
      CancellationToken: class {},
    }));

    vi.doMock('./client.js', () => ({
      getOllamaClient: vi.fn().mockResolvedValue({
        list: vi.fn().mockResolvedValue({ models: [] }),
        ps: vi.fn().mockResolvedValue({ models: [] }),
        show: vi.fn().mockResolvedValue({ template: '' }),
      }),
      testConnection: vi.fn().mockResolvedValue(true),
    }));

    vi.doMock('./provider.js', () => ({
      OllamaChatModelProvider: class {
        setAuthToken = vi.fn();
      },
    }));

    vi.doMock('./sidebar.js', () => ({
      registerSidebar: vi.fn(),
    }));

    vi.doMock('./modelfiles.js', () => ({
      registerModelfileManager: vi.fn(),
    }));

    const ext = await import('./extension.js');

    await expect(ext.activate({ subscriptions: [], extensionUri: {} } as any)).rejects.toThrow(unhandledError);
  });

  it('registers command for managing auth tokens', async () => {
    const registerCommand = vi.fn(() => ({ dispose: vi.fn() }));

    vi.doMock('vscode', () => ({
      TreeItem: class {
        constructor(public label: string) {}
      },
      TreeItemCollapsibleState: {
        None: 0,
        Collapsed: 1,
        Expanded: 2,
      },
      EventEmitter: class {
        event = {};
        fire = vi.fn();
      },
      window: {
        registerTreeDataProvider: vi.fn(() => ({ dispose: vi.fn() })),
        registerWebviewViewProvider: vi.fn(() => ({ dispose: vi.fn() })),
        createOutputChannel: vi.fn(() => ({
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          debug: vi.fn(),
          log: vi.fn(),
          show: vi.fn(),
        })),
        showInputBox: vi.fn(),
        showErrorMessage: vi.fn(),
        showInformationMessage: vi.fn(),
        withProgress: vi.fn(async (_options: any, callback: any) => callback({})),
      },
      commands: {
        registerCommand,
        executeCommand: vi.fn(),
      },
      workspace: {
        getConfiguration: vi.fn(() => ({
          get: vi.fn((key: string) => {
            if (key === 'autoStartLogStreaming') return false;
            if (key === 'localModelRefreshInterval') return 0;
            if (key === 'libraryRefreshInterval') return 0;
            return undefined;
          }),
        })),
        onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
      },
      lm: {
        registerLanguageModelChatProvider: vi.fn(() => ({ dispose: vi.fn() })),
      },
      chat: {
        createChatParticipant: vi.fn(() => ({
          iconPath: undefined,
          dispose: vi.fn(),
        })),
      },
      Uri: {
        joinPath: vi.fn((_base: any, _path: string) => ({ fsPath: _path })),
      },
      ChatResponseMarkdownPart: class {
        value: any = {};
      },
      LanguageModelChatMessage: {
        User: vi.fn(),
        Assistant: vi.fn(),
      },
      LanguageModelTextPart: class {},
      CancellationToken: class {},
    }));

    vi.doMock('./client.js', () => ({
      getOllamaClient: vi.fn().mockResolvedValue({
        list: vi.fn().mockResolvedValue({ models: [] }),
        ps: vi.fn().mockResolvedValue({ models: [] }),
        show: vi.fn().mockResolvedValue({ template: '' }),
      }),
      testConnection: vi.fn().mockResolvedValue(true),
    }));

    vi.doMock('./provider.js', () => ({
      OllamaChatModelProvider: class {
        setAuthToken = vi.fn();
      },
    }));

    vi.doMock('./sidebar.js', () => ({
      registerSidebar: vi.fn(),
    }));

    vi.doMock('./modelfiles.js', () => ({
      registerModelfileManager: vi.fn(),
    }));

    const ext = await import('./extension.js');
    await ext.activate({ subscriptions: [], extensionUri: {} } as any);

    expect(registerCommand).toHaveBeenCalledWith('ollama-copilot.manageAuthToken', expect.any(Function));
  });

  it('handles autoStartLogStreaming configuration changes', async () => {
    const mockInfo = vi.fn();
    const onDidChangeConfiguration = vi.fn();
    let configChangeCallback: any;

    onDidChangeConfiguration.mockImplementation((cb: any) => {
      configChangeCallback = cb;
      return { dispose: vi.fn() };
    });

    vi.doMock('vscode', () => ({
      TreeItem: class {
        constructor(public label: string) {}
      },
      TreeItemCollapsibleState: {
        None: 0,
        Collapsed: 1,
        Expanded: 2,
      },
      EventEmitter: class {
        event = {};
        fire = vi.fn();
      },
      window: {
        registerTreeDataProvider: vi.fn(() => ({ dispose: vi.fn() })),
        registerWebviewViewProvider: vi.fn(() => ({ dispose: vi.fn() })),
        createOutputChannel: vi.fn(() => ({
          info: mockInfo,
          warn: vi.fn(),
          error: vi.fn(),
          debug: vi.fn(),
          log: vi.fn(),
          show: vi.fn(),
        })),
        showInputBox: vi.fn(),
        showErrorMessage: vi.fn(),
        showInformationMessage: vi.fn(),
        withProgress: vi.fn(async (_options: any, callback: any) => callback({})),
      },
      commands: {
        registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
        executeCommand: vi.fn(),
      },
      workspace: {
        getConfiguration: vi.fn(() => ({
          get: vi.fn((key: string) => {
            if (key === 'autoStartLogStreaming') return false;
            if (key === 'localModelRefreshInterval') return 0;
            if (key === 'libraryRefreshInterval') return 0;
            return undefined;
          }),
        })),
        onDidChangeConfiguration,
      },
      lm: {
        registerLanguageModelChatProvider: vi.fn(() => ({ dispose: vi.fn() })),
      },
      chat: {
        createChatParticipant: vi.fn(() => ({
          iconPath: undefined,
          dispose: vi.fn(),
        })),
      },
      Uri: {
        joinPath: vi.fn((_base: any, _path: string) => ({ fsPath: _path })),
      },
      ChatResponseMarkdownPart: class {
        value: any = {};
      },
      LanguageModelChatMessage: {
        User: vi.fn(),
        Assistant: vi.fn(),
      },
      LanguageModelTextPart: class {},
      CancellationToken: class {},
    }));

    vi.doMock('./client.js', () => ({
      getOllamaClient: vi.fn().mockResolvedValue({
        list: vi.fn().mockResolvedValue({ models: [] }),
        ps: vi.fn().mockResolvedValue({ models: [] }),
        show: vi.fn().mockResolvedValue({ template: '' }),
      }),
      testConnection: vi.fn().mockResolvedValue(true),
    }));

    vi.doMock('./diagnostics.js', () => ({
      createDiagnosticsLogger: (output: any) => ({
        info: output.info,
        warn: output.warn,
        error: output.error,
        debug: output.debug,
        exception: vi.fn(),
      }),
      getConfiguredLogLevel: vi.fn(() => 'info'),
    }));

    vi.doMock('./provider.js', () => ({
      OllamaChatModelProvider: class {
        setAuthToken = vi.fn();
      },
    }));

    vi.doMock('./sidebar.js', () => ({
      registerSidebar: vi.fn(),
    }));

    vi.doMock('./modelfiles.js', () => ({
      registerModelfileManager: vi.fn(),
    }));

    const ext = await import('./extension.js');
    await ext.activate({ subscriptions: [], extensionUri: {} } as any);

    // Simulate streamLogs configuration change
    if (configChangeCallback) {
      configChangeCallback({
        affectsConfiguration: (key: string) => key === 'ollama.streamLogs',
      });
    }

    expect(mockInfo).toHaveBeenCalledWith(expect.stringContaining('Auto-start log streaming setting changed'));
  });
});

describe('handleChatRequest', () => {
  it('exports handleChatRequest function', async () => {
    const ext = await import('./extension.js');

    expect(typeof ext.handleChatRequest).toBe('function');
  });
});

describe('handleChatRequest direct Ollama path (thinking + tools)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('streams thinking tokens with a reasoning header and separator', async () => {
    vi.doMock('./client.js', () => ({ getOllamaClient: vi.fn(), testConnection: vi.fn() }));
    vi.doMock('./diagnostics.js', () => ({
      createDiagnosticsLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        exception: vi.fn(),
      }),
      getConfiguredLogLevel: vi.fn(() => 'info'),
    }));
    vi.doMock('./provider.js', () => ({
      OllamaChatModelProvider: class {
        setAuthToken = vi.fn();
      },
      isThinkingModelId: (id: string) => /(qwen3|qwq|deepseek-?r1|cogito|phi\d+-reasoning)/i.test(id),
    }));
    vi.doMock('./sidebar.js', () => ({ registerSidebar: vi.fn() }));
    vi.doMock('./modelfiles.js', () => ({ registerModelfileManager: vi.fn() }));
    vi.doMock('vscode', () => ({
      LanguageModelTextPart: class {
        constructor(public value: string) {}
      },
      LanguageModelChatMessageRole: { User: 1, Assistant: 2 },
      ChatRequestTurn: class {},
      ChatResponseTurn: class {},
      ChatResponseMarkdownPart: class {},
      LanguageModelChatMessage: {
        User: (content: string) => ({ role: 1, content }),
        Assistant: (content: string) => ({ role: 2, content }),
      },
      lm: { selectChatModels: vi.fn().mockResolvedValue([]) },
      workspace: { getConfiguration: vi.fn().mockReturnValue({ get: vi.fn() }) },
    }));

    const ext = await import('./extension.js');

    const mockMarkdown = vi.fn();
    const stream = { markdown: mockMarkdown };
    const token = { isCancellationRequested: false };

    const mockClient = {
      chat: vi.fn().mockResolvedValue(
        (async function* () {
          yield { message: { thinking: 'step 1: consider options' } };
          yield { message: { thinking: ' step 2: decide' } };
          yield { message: { content: 'The answer is 42.' } };
          yield { message: {}, done: true };
        })(),
      ),
    };

    const request = {
      prompt: 'what is the meaning of life?',
      model: { vendor: 'selfagency-ollama', id: 'qwen3:8b' },
    };

    await ext.handleChatRequest(request as any, { history: [] } as any, stream as any, token as any, mockClient as any);

    const allCalls = mockMarkdown.mock.calls.map((c: any[]) => c[0] as string);
    // Thinking header should appear
    expect(allCalls.some((v: string) => v.includes('Thinking') || v.includes('thinking'))).toBe(true);
    // Thinking content should be streamed
    expect(allCalls.some((v: string) => v.includes('step 1: consider options'))).toBe(true);
    // Separator before answer
    expect(allCalls.some((v: string) => v.includes('---'))).toBe(true);
    // Final answer
    expect(allCalls.some((v: string) => v.includes('The answer is 42.'))).toBe(true);
  });

  it('passes think: true for known thinking model IDs', async () => {
    vi.doMock('./client.js', () => ({ getOllamaClient: vi.fn(), testConnection: vi.fn() }));
    vi.doMock('./diagnostics.js', () => ({
      createDiagnosticsLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        exception: vi.fn(),
      }),
      getConfiguredLogLevel: vi.fn(() => 'info'),
    }));
    vi.doMock('./provider.js', () => ({
      OllamaChatModelProvider: class {
        setAuthToken = vi.fn();
      },
      isThinkingModelId: (id: string) => /(qwen3|qwq|deepseek-?r1|cogito|phi\d+-reasoning)/i.test(id),
    }));
    vi.doMock('./sidebar.js', () => ({ registerSidebar: vi.fn() }));
    vi.doMock('./modelfiles.js', () => ({ registerModelfileManager: vi.fn() }));
    vi.doMock('vscode', () => ({
      LanguageModelTextPart: class {
        constructor(public value: string) {}
      },
      LanguageModelChatMessageRole: { User: 1, Assistant: 2 },
      ChatRequestTurn: class {},
      ChatResponseTurn: class {},
      ChatResponseMarkdownPart: class {},
      LanguageModelChatMessage: {
        User: (content: string) => ({ role: 1, content }),
        Assistant: (content: string) => ({ role: 2, content }),
      },
      lm: { selectChatModels: vi.fn().mockResolvedValue([]) },
      workspace: { getConfiguration: vi.fn().mockReturnValue({ get: vi.fn() }) },
      Uri: { joinPath: vi.fn((_base: any, p: string) => ({ fsPath: p })) },
      chat: { createChatParticipant: vi.fn(() => ({ iconPath: undefined, dispose: vi.fn() })) },
      commands: { registerCommand: vi.fn(() => ({ dispose: vi.fn() })), executeCommand: vi.fn() },
    }));

    const ext = await import('./extension.js');

    const mockChat = vi.fn().mockResolvedValue(
      (async function* () {
        yield { message: { content: 'ok' }, done: true };
      })(),
    );

    const mockClient = { chat: mockChat };
    const stream = { markdown: vi.fn() };
    const token = { isCancellationRequested: false };

    const request = {
      prompt: 'hi',
      model: { vendor: 'selfagency-ollama', id: 'qwen3:8b' },
    };

    await ext.handleChatRequest(request as any, { history: [] } as any, stream as any, token as any, mockClient as any);

    expect(mockChat).toHaveBeenCalledWith(expect.objectContaining({ think: true }));
  });

  it('formats tool calls as markdown in participant path', async () => {
    vi.doMock('./client.js', () => ({ getOllamaClient: vi.fn(), testConnection: vi.fn() }));
    vi.doMock('./diagnostics.js', () => ({
      createDiagnosticsLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        exception: vi.fn(),
      }),
      getConfiguredLogLevel: vi.fn(() => 'info'),
    }));
    vi.doMock('./provider.js', () => ({
      OllamaChatModelProvider: class {
        setAuthToken = vi.fn();
      },
      isThinkingModelId: (id: string) => /(qwen3|qwq|deepseek-?r1|cogito|phi\d+-reasoning)/i.test(id),
    }));
    vi.doMock('./sidebar.js', () => ({ registerSidebar: vi.fn() }));
    vi.doMock('./modelfiles.js', () => ({ registerModelfileManager: vi.fn() }));
    vi.doMock('vscode', () => ({
      LanguageModelTextPart: class {
        constructor(public value: string) {}
      },
      LanguageModelChatMessageRole: { User: 1, Assistant: 2 },
      ChatRequestTurn: class {},
      ChatResponseTurn: class {},
      ChatResponseMarkdownPart: class {},
      LanguageModelChatMessage: {
        User: (content: string) => ({ role: 1, content }),
        Assistant: (content: string) => ({ role: 2, content }),
      },
      lm: { selectChatModels: vi.fn().mockResolvedValue([]) },
      workspace: { getConfiguration: vi.fn().mockReturnValue({ get: vi.fn() }) },
      Uri: { joinPath: vi.fn((_base: any, p: string) => ({ fsPath: p })) },
      chat: { createChatParticipant: vi.fn(() => ({ iconPath: undefined, dispose: vi.fn() })) },
      commands: { registerCommand: vi.fn(() => ({ dispose: vi.fn() })), executeCommand: vi.fn() },
    }));

    const ext = await import('./extension.js');

    const mockMarkdown = vi.fn();
    const stream = { markdown: mockMarkdown };
    const token = { isCancellationRequested: false };

    const mockClient = {
      chat: vi.fn().mockResolvedValue(
        (async function* () {
          yield {
            message: {
              tool_calls: [{ function: { name: 'get_weather', arguments: { location: 'NYC' } } }],
            },
          };
          yield { message: { content: 'It is sunny in NYC.' }, done: true };
        })(),
      ),
    };

    const request = {
      prompt: "what's the weather?",
      model: { vendor: 'selfagency-ollama', id: 'llama3.2:latest' },
    };

    await ext.handleChatRequest(request as any, { history: [] } as any, stream as any, token as any, mockClient as any);

    const allCalls = mockMarkdown.mock.calls.map((c: any[]) => c[0] as string);
    expect(allCalls.some((v: string) => v.includes('get_weather'))).toBe(true);
  });
});

describe('handleConnectionTestFailure', () => {
  it('shows error message and executes command when Open Settings selected', async () => {
    const showErrorMessage = vi.fn().mockResolvedValue('Open Settings');
    const executeCommand = vi.fn().mockResolvedValue(undefined);

    const ext = await import('./extension.js');
    await ext.handleConnectionTestFailure('http://localhost:11434', { showErrorMessage }, { executeCommand });

    expect(showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('Cannot connect to Ollama server'),
      'Open Settings',
    );
    expect(executeCommand).toHaveBeenCalledWith('workbench.action.openSettings', 'ollama');
  });

  it('shows error message but does not execute command when not selected', async () => {
    const showErrorMessage = vi.fn().mockResolvedValue(undefined);
    const executeCommand = vi.fn();

    const ext = await import('./extension.js');
    await ext.handleConnectionTestFailure('http://localhost:11434', { showErrorMessage }, { executeCommand });

    expect(showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('Cannot connect to Ollama server'),
      'Open Settings',
    );
    expect(executeCommand).not.toHaveBeenCalled();
  });
});

describe('setupChatParticipant', () => {
  it('creates and configures chat participant', async () => {
    const mockParticipant = {
      iconPath: undefined,
      dispose: vi.fn(),
    };
    const createChatParticipant = vi.fn(() => mockParticipant);

    const ext = await import('./extension.js');
    const mockHandler = vi.fn() as any;
    const mockContext = { extensionUri: '/test' };

    const result = ext.setupChatParticipant(mockContext as any, mockHandler, { createChatParticipant } as any);

    expect(createChatParticipant).toHaveBeenCalledWith('ollama-copilot.ollama', mockHandler);
    expect(mockParticipant.iconPath).toBeDefined();
    expect(result).toBe(mockParticipant);
  });
});

describe('handleChatRequest errors', () => {
  it('handles errors during chat request', async () => {
    const mockMarkdown = vi.fn();
    const mockStream = { markdown: mockMarkdown };

    const ext = await import('./extension.js');

    const mockRequest = {
      prompt: 'test',
      model: {
        vendor: 'selfagency-ollama',
        sendRequest: vi.fn(() => {
          throw new Error('Model error');
        }),
      },
    };

    const mockChatContext = { history: [] };
    const mockToken = { isCancellationRequested: false };

    await ext.handleChatRequest(mockRequest as any, mockChatContext as any, mockStream as any, mockToken as any);

    expect(mockMarkdown).toHaveBeenCalledWith(expect.stringContaining('Error: Model error'));
  });
});

describe('handleChatRequest model selection', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('shows error when no Ollama models are available', async () => {
    const mockSelectChatModels = vi.fn().mockResolvedValue([]);

    vi.doMock('vscode', () => ({
      LanguageModelTextPart: class {
        constructor(public value: string) {}
      },
      ChatRequestTurn: class {},
      ChatResponseTurn: class {},
      ChatResponseMarkdownPart: class {},
      LanguageModelChatMessage: {
        User: (content: string) => ({ content }),
        Assistant: (content: string) => ({ content }),
      },
      lm: { selectChatModels: mockSelectChatModels },
    }));

    const ext = await import('./extension.js');
    const mockMarkdown = vi.fn();
    const mockRequest = { prompt: 'test', model: { vendor: 'copilot' } };

    await ext.handleChatRequest(
      mockRequest as any,
      { history: [] } as any,
      { markdown: mockMarkdown } as any,
      { isCancellationRequested: false } as any,
    );

    expect(mockMarkdown).toHaveBeenCalledWith(expect.stringContaining('No Ollama models available'));
  });

  it('uses model from selectChatModels when request.model is not our vendor', async () => {
    const LMTextPart = class {
      constructor(public value: string) {}
    };
    const mockSendRequest = vi.fn().mockResolvedValue({
      stream: (async function* () {
        yield new LMTextPart('hello from ollama');
      })(),
    });
    const mockSelectChatModels = vi
      .fn()
      .mockResolvedValue([{ vendor: 'selfagency-ollama', sendRequest: mockSendRequest }]);

    vi.doMock('vscode', () => ({
      LanguageModelTextPart: LMTextPart,
      ChatRequestTurn: class {},
      ChatResponseTurn: class {},
      ChatResponseMarkdownPart: class {},
      LanguageModelChatMessage: {
        User: (content: string) => ({ content }),
        Assistant: (content: string) => ({ content }),
      },
      lm: { selectChatModels: mockSelectChatModels },
      workspace: { getConfiguration: vi.fn().mockReturnValue({ get: vi.fn() }) },
    }));

    const ext = await import('./extension.js');
    const mockMarkdown = vi.fn();
    const mockRequest = { prompt: 'test', model: { vendor: 'copilot' } };

    await ext.handleChatRequest(
      mockRequest as any,
      { history: [] } as any,
      { markdown: mockMarkdown } as any,
      { isCancellationRequested: false } as any,
    );

    expect(mockSelectChatModels).toHaveBeenCalled();
    expect(mockSendRequest).toHaveBeenCalled();
    expect(mockMarkdown).toHaveBeenCalledWith('hello from ollama');
  });

  it('uses request.model directly when it is already our vendor', async () => {
    const LMTextPart = class {
      constructor(public value: string) {}
    };
    const mockSelectChatModels = vi.fn();
    const mockSendRequest = vi.fn().mockResolvedValue({
      stream: (async function* () {
        yield new LMTextPart('response from chosen model');
      })(),
    });

    vi.doMock('vscode', () => ({
      LanguageModelTextPart: LMTextPart,
      ChatRequestTurn: class {},
      ChatResponseTurn: class {},
      ChatResponseMarkdownPart: class {},
      LanguageModelChatMessage: {
        User: (content: string) => ({ content }),
        Assistant: (content: string) => ({ content }),
      },
      lm: { selectChatModels: mockSelectChatModels },
      workspace: { getConfiguration: vi.fn().mockReturnValue({ get: vi.fn() }) },
    }));

    const ext = await import('./extension.js');
    const mockMarkdown = vi.fn();
    const mockRequest = {
      prompt: 'test',
      model: { vendor: 'selfagency-ollama', sendRequest: mockSendRequest },
    };

    await ext.handleChatRequest(
      mockRequest as any,
      { history: [] } as any,
      { markdown: mockMarkdown } as any,
      { isCancellationRequested: false } as any,
    );

    expect(mockSendRequest).toHaveBeenCalled();
    expect(mockMarkdown).toHaveBeenCalledWith('response from chosen model');
    expect(mockSelectChatModels).not.toHaveBeenCalled();
  });
});

describe('handleBuiltInOllamaConflict', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('vscode', () => ({
      TreeItem: class {
        constructor(public label: string) {}
      },
      TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
      EventEmitter: class {
        event = {};
        fire = vi.fn();
      },
      ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
      ProgressLocation: { Notification: 15 },
      Disposable: class {
        dispose = vi.fn();
      },
      env: { openExternal: vi.fn() },
      Uri: { joinPath: vi.fn().mockReturnValue(undefined), parse: vi.fn() },
      window: {
        createOutputChannel: vi.fn(() => ({
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          debug: vi.fn(),
          log: vi.fn(),
          show: vi.fn(),
        })),
        showWarningMessage: vi.fn(),
        showInformationMessage: vi.fn(),
        showErrorMessage: vi.fn(),
        showInputBox: vi.fn(),
        registerTreeDataProvider: vi.fn(() => ({ dispose: vi.fn() })),
        registerWebviewViewProvider: vi.fn(() => ({ dispose: vi.fn() })),
        withProgress: vi.fn(async (_: any, cb: any) => cb({ report: vi.fn() })),
      },
      workspace: {
        getConfiguration: vi.fn(() => ({ get: vi.fn(), update: vi.fn() })),
        onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
      },
      commands: {
        registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
        executeCommand: vi.fn().mockResolvedValue(undefined),
      },
      lm: {
        registerLanguageModelChatProvider: vi.fn(() => ({ dispose: vi.fn() })),
        selectChatModels: vi.fn().mockResolvedValue([]),
        onDidChangeChatModels: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      },
      chat: {
        createChatParticipant: vi.fn(() => ({ iconPath: undefined, dispose: vi.fn() })),
      },
      LanguageModelChatMessage: {
        User: vi.fn((c: string) => ({ content: c })),
        Assistant: vi.fn((c: string) => ({ content: c })),
      },
      LanguageModelTextPart: class {
        constructor(public value: string) {}
      },
      ChatRequestTurn: class {},
      ChatResponseTurn: class {},
      ChatResponseMarkdownPart: class {},
    }));
  });

  it('does nothing when no conflicting models are registered', async () => {
    const showWarningMessage = vi.fn();
    const selectChatModels = vi.fn().mockResolvedValue([]);

    const ext = await import('./extension.js');
    await ext.handleBuiltInOllamaConflict(
      { showWarningMessage, showInformationMessage: vi.fn(), showErrorMessage: vi.fn() },
      { getConfiguration: vi.fn() },
      { selectChatModels },
    );

    expect(selectChatModels).toHaveBeenCalledWith({ vendor: 'ollama' });
    expect(showWarningMessage).not.toHaveBeenCalled();
  });

  it('shows a warning when conflicting models are present', async () => {
    const showWarningMessage = vi.fn().mockResolvedValue(undefined);
    const selectChatModels = vi.fn().mockResolvedValue([{ id: 'ollama:llama3', vendor: 'ollama', name: 'Llama 3' }]);

    const ext = await import('./extension.js');
    await ext.handleBuiltInOllamaConflict(
      { showWarningMessage, showInformationMessage: vi.fn(), showErrorMessage: vi.fn() },
      { getConfiguration: vi.fn() },
      { selectChatModels },
    );

    expect(showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('built-in Ollama provider'),
      'Disable Built-in Ollama Provider',
    );
  });

  it('does nothing when user dismisses the warning', async () => {
    const showWarningMessage = vi.fn().mockResolvedValue(undefined);
    const showInformationMessage = vi.fn();
    const mockConfig = { update: vi.fn() };
    const getConfiguration = vi.fn().mockReturnValue(mockConfig);
    const selectChatModels = vi.fn().mockResolvedValue([{ id: 'ollama:llama3', vendor: 'ollama', name: 'Llama 3' }]);

    const ext = await import('./extension.js');
    await ext.handleBuiltInOllamaConflict(
      { showWarningMessage, showInformationMessage, showErrorMessage: vi.fn() },
      { getConfiguration },
      { selectChatModels },
    );

    expect(showWarningMessage).toHaveBeenCalled();
    expect(showInformationMessage).not.toHaveBeenCalled();
    expect(mockConfig.update).not.toHaveBeenCalled();
  });

  it('clears ollama.url setting when user confirms', async () => {
    const showWarningMessage = vi.fn().mockResolvedValue('Disable Built-in Ollama Provider');
    const showInformationMessage = vi.fn().mockResolvedValue('Reload Window');
    const mockConfig = { update: vi.fn().mockResolvedValue(undefined) };
    const getConfiguration = vi.fn().mockReturnValue(mockConfig);
    const selectChatModels = vi.fn().mockResolvedValue([{ id: 'ollama:llama3', vendor: 'ollama', name: 'Llama 3' }]);
    const executeCommand = vi.fn().mockResolvedValue(undefined);

    const ext = await import('./extension.js');
    await ext.handleBuiltInOllamaConflict(
      { showWarningMessage, showInformationMessage, showErrorMessage: vi.fn() },
      { getConfiguration },
      { selectChatModels },
      { executeCommand },
    );

    expect(mockConfig.update).toHaveBeenCalledWith('ollama.url', '', expect.anything());
    expect(showInformationMessage).toHaveBeenCalledWith(expect.stringContaining('Reload VS Code'), 'Reload Window');
    expect(executeCommand).toHaveBeenCalledWith('workbench.action.reloadWindow');
  });
});

describe('handleConfigurationChange', () => {
  it('calls onLogLevelChange when log level configuration changes', async () => {
    const mockDiagnostics = { info: vi.fn() };
    const onLogLevelChange = vi.fn();

    const ext = await import('./extension.js');
    const event = {
      affectsConfiguration: vi.fn((key: string) => {
        if (key === 'ollama.diagnostics.logLevel') return true;
        if (key === 'ollama.autoStartLogStreaming') return false;
        return false;
      }),
    };

    ext.handleConfigurationChange(event as any, mockDiagnostics as any, onLogLevelChange, undefined);

    expect(onLogLevelChange).toHaveBeenCalled();
    expect(mockDiagnostics.info).toHaveBeenCalledWith(expect.stringContaining('Diagnostics log level changed'));
  });

  it('calls onAutoStartChange when auto-start configuration changes', async () => {
    const mockDiagnostics = { info: vi.fn() };
    const onAutoStartChange = vi.fn();

    const ext = await import('./extension.js');
    const event = {
      affectsConfiguration: vi.fn((key: string) => {
        if (key === 'ollama.diagnostics.logLevel') return false;
        if (key === 'ollama.streamLogs') return true;
        return false;
      }),
    };

    ext.handleConfigurationChange(event as any, mockDiagnostics as any, undefined, onAutoStartChange);

    expect(onAutoStartChange).toHaveBeenCalled();
    expect(mockDiagnostics.info).toHaveBeenCalledWith(
      expect.stringContaining('Auto-start log streaming setting changed'),
    );
  });

  it('returns early if autoStartLogStreaming configuration is not affected', async () => {
    const mockDiagnostics = { info: vi.fn() };
    const onAutoStartChange = vi.fn();

    const ext = await import('./extension.js');
    const event = {
      affectsConfiguration: vi.fn((key: string) => {
        if (key === 'ollama.diagnostics.logLevel') return false;
        if (key === 'ollama.streamLogs') return false;
        return false;
      }),
    };

    ext.handleConfigurationChange(event as any, mockDiagnostics as any, undefined, onAutoStartChange);

    expect(onAutoStartChange).not.toHaveBeenCalled();
  });

  it('calls both callbacks when both configurations change', async () => {
    const mockDiagnostics = { info: vi.fn() };
    const onLogLevelChange = vi.fn();
    const onAutoStartChange = vi.fn();

    const ext = await import('./extension.js');
    const event = {
      affectsConfiguration: vi.fn((key: string) => {
        if (key === 'ollama.diagnostics.logLevel') return true;
        if (key === 'ollama.streamLogs') return true;
        return false;
      }),
    };

    ext.handleConfigurationChange(event as any, mockDiagnostics as any, onLogLevelChange, onAutoStartChange);

    expect(onLogLevelChange).toHaveBeenCalled();
    expect(onAutoStartChange).toHaveBeenCalled();
  });
});
