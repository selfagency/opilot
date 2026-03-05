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
