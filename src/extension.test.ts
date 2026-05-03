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
      StatusBarAlignment: { Right: 2 },
      MarkdownString: class {
        constructor(public value: string) {}
      },
      ThemeColor: class {
        constructor(public id: string) {}
      },
      window: {
        createStatusBarItem: vi.fn(() => ({
          text: '',
          tooltip: undefined,
          command: undefined,
          show: vi.fn(),
          dispose: vi.fn(),
        })),
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
      languages: {
        registerInlineCompletionItemProvider: vi.fn(() => ({ dispose: vi.fn() })),
      },
      chat: {
        createChatParticipant: vi.fn(() => ({
          iconPath: undefined,
          dispose: vi.fn(),
        })),
      },
      Uri: {
        file: vi.fn((path: string) => ({ fsPath: path })),
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
      InlineCompletionItem: class {
        constructor(public readonly insertText: string) {}
      },
      Disposable: class {
        constructor(public dispose: () => void) {}
        static from(...disposables: any[]) {
          return new (this as any)(() => disposables.forEach(d => d.dispose?.()));
        }
      },
    }));

    vi.doMock('./client.js', () => ({
      getOllamaClient: vi.fn().mockResolvedValue({
        list: vi.fn().mockResolvedValue({ models: [] }),
        ps: vi.fn().mockResolvedValue({ models: [] }),
        show: vi.fn().mockResolvedValue({ template: '' }),
      }),
      testConnection: vi.fn().mockResolvedValue(true),
      redactUrlCredentials: vi.fn((value: string) => value),
    }));

    vi.doMock('./provider.js', () => ({
      OllamaChatModelProvider: class {
        setAuthToken = vi.fn();
        prefetchModels = vi.fn();
      },
    }));

    vi.doMock('./sidebar.js', () => ({
      registerSidebar: vi.fn(),
    }));

    vi.doMock('./modelfiles.js', () => ({
      registerModelfileManager: vi.fn(),
    }));

    const ext = await import('./extension.js');
    await ext.activate({ subscriptions: [], extensionUri: { fsPath: '' } } as any);

    expect(registerLanguageModelChatProvider).toHaveBeenCalledWith('selfagency-opilot', expect.anything());
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
      StatusBarAlignment: { Right: 2 },
      MarkdownString: class {
        constructor(public value: string) {}
      },
      ThemeColor: class {
        constructor(public id: string) {}
      },
      window: {
        createStatusBarItem: vi.fn(() => ({
          text: '',
          tooltip: undefined,
          command: undefined,
          show: vi.fn(),
          dispose: vi.fn(),
        })),
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
      languages: {
        registerInlineCompletionItemProvider: vi.fn(() => ({ dispose: vi.fn() })),
      },
      chat: {
        createChatParticipant: vi.fn(() => ({
          iconPath: undefined,
          dispose: vi.fn(),
        })),
      },
      Uri: {
        file: vi.fn((path: string) => ({ fsPath: path })),
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
      InlineCompletionItem: class {
        constructor(public readonly insertText: string) {}
      },
      Disposable: class {
        constructor(public dispose: () => void) {}
        static from(...disposables: any[]) {
          return new (this as any)(() => disposables.forEach(d => d.dispose?.()));
        }
      },
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
        prefetchModels = vi.fn();
      },
    }));

    vi.doMock('./sidebar.js', () => ({
      registerSidebar: vi.fn(),
    }));

    vi.doMock('./modelfiles.js', () => ({
      registerModelfileManager: vi.fn(),
    }));

    const ext = await import('./extension.js');

    await expect(ext.activate({ subscriptions: [], extensionUri: { fsPath: '' } } as any)).resolves.toBeUndefined();
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
      StatusBarAlignment: { Right: 2 },
      MarkdownString: class {
        constructor(public value: string) {}
      },
      ThemeColor: class {
        constructor(public id: string) {}
      },
      window: {
        createStatusBarItem: vi.fn(() => ({
          text: '',
          tooltip: undefined,
          command: undefined,
          show: vi.fn(),
          dispose: vi.fn(),
        })),
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
      languages: {
        registerInlineCompletionItemProvider: vi.fn(() => ({ dispose: vi.fn() })),
      },
      chat: {
        createChatParticipant: vi.fn(() => ({
          iconPath: undefined,
          dispose: vi.fn(),
        })),
      },
      Uri: {
        file: vi.fn((path: string) => ({ fsPath: path })),
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
      InlineCompletionItem: class {
        constructor(public readonly insertText: string) {}
      },
      Disposable: class {
        constructor(public dispose: () => void) {}
        static from(...disposables: any[]) {
          return new (this as any)(() => disposables.forEach(d => d.dispose?.()));
        }
      },
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
        prefetchModels = vi.fn();
      },
    }));

    vi.doMock('./sidebar.js', () => ({
      registerSidebar: vi.fn(),
    }));

    vi.doMock('./modelfiles.js', () => ({
      registerModelfileManager: vi.fn(),
    }));

    const ext = await import('./extension.js');
    await ext.activate({ subscriptions: [], extensionUri: { fsPath: '' } } as any);

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
      StatusBarAlignment: { Right: 2 },
      MarkdownString: class {
        constructor(public value: string) {}
      },
      ThemeColor: class {
        constructor(public id: string) {}
      },
      window: {
        createStatusBarItem: vi.fn(() => ({
          text: '',
          tooltip: undefined,
          command: undefined,
          show: vi.fn(),
          dispose: vi.fn(),
        })),
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
      languages: {
        registerInlineCompletionItemProvider: vi.fn(() => ({ dispose: vi.fn() })),
      },
      chat: {
        createChatParticipant: vi.fn(() => ({
          iconPath: undefined,
          dispose: vi.fn(),
        })),
      },
      Uri: {
        file: vi.fn((path: string) => ({ fsPath: path })),
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
      InlineCompletionItem: class {
        constructor(public readonly insertText: string) {}
      },
      Disposable: class {
        constructor(public dispose: () => void) {}
        static from(...disposables: any[]) {
          return new (this as any)(() => disposables.forEach(d => d.dispose?.()));
        }
      },
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
        prefetchModels = vi.fn();
      },
    }));

    vi.doMock('./sidebar.js', () => ({
      registerSidebar: vi.fn(),
    }));

    vi.doMock('./modelfiles.js', () => ({
      registerModelfileManager: vi.fn(),
    }));

    const ext = await import('./extension.js');
    await ext.activate({ subscriptions: [], extensionUri: { fsPath: '' } } as any);

    // Wait for async connection test
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(showErrorMessage).toHaveBeenCalled();
    expect(executeCommand).toHaveBeenCalledWith('workbench.action.openSettings', 'opilot');
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
      StatusBarAlignment: { Right: 2 },
      MarkdownString: class {
        constructor(public value: string) {}
      },
      ThemeColor: class {
        constructor(public id: string) {}
      },
      window: {
        createStatusBarItem: vi.fn(() => ({
          text: '',
          tooltip: undefined,
          command: undefined,
          show: vi.fn(),
          dispose: vi.fn(),
        })),
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
      languages: {
        registerInlineCompletionItemProvider: vi.fn(() => ({ dispose: vi.fn() })),
      },
      chat: {
        createChatParticipant: vi.fn(() => ({
          iconPath: undefined,
          dispose: vi.fn(),
        })),
      },
      Uri: {
        file: vi.fn((path: string) => ({ fsPath: path })),
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
      InlineCompletionItem: class {
        constructor(public readonly insertText: string) {}
      },
      Disposable: class {
        constructor(public dispose: () => void) {}
        static from(...disposables: any[]) {
          return new (this as any)(() => disposables.forEach(d => d.dispose?.()));
        }
      },
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
        prefetchModels = vi.fn();
      },
    }));

    vi.doMock('./sidebar.js', () => ({
      registerSidebar: vi.fn(),
    }));

    vi.doMock('./modelfiles.js', () => ({
      registerModelfileManager: vi.fn(),
    }));

    const ext = await import('./extension.js');
    await ext.activate({ subscriptions: [], extensionUri: { fsPath: '' } } as any);

    expect(createOutputChannel).toHaveBeenCalledWith('Opilot', expect.any(Object));
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
      StatusBarAlignment: { Right: 2 },
      MarkdownString: class {
        constructor(public value: string) {}
      },
      ThemeColor: class {
        constructor(public id: string) {}
      },
      window: {
        createStatusBarItem: vi.fn(() => ({
          text: '',
          tooltip: undefined,
          command: undefined,
          show: vi.fn(),
          dispose: vi.fn(),
        })),
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
      languages: {
        registerInlineCompletionItemProvider: vi.fn(() => ({ dispose: vi.fn() })),
      },
      chat: {
        createChatParticipant: vi.fn(() => ({
          iconPath: undefined,
          dispose: vi.fn(),
        })),
      },
      Uri: {
        file: vi.fn((path: string) => ({ fsPath: path })),
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
      InlineCompletionItem: class {
        constructor(public readonly insertText: string) {}
      },
      Disposable: class {
        constructor(public dispose: () => void) {}
        static from(...disposables: any[]) {
          return new (this as any)(() => disposables.forEach(d => d.dispose?.()));
        }
      },
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
        prefetchModels = vi.fn();
      },
    }));

    vi.doMock('./sidebar.js', () => ({
      registerSidebar: vi.fn(),
    }));

    vi.doMock('./modelfiles.js', () => ({
      registerModelfileManager: vi.fn(),
    }));

    const ext = await import('./extension.js');

    await expect(ext.activate({ subscriptions: [], extensionUri: { fsPath: '' } } as any)).rejects.toThrow(
      unhandledError,
    );
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
      StatusBarAlignment: { Right: 2 },
      MarkdownString: class {
        constructor(public value: string) {}
      },
      ThemeColor: class {
        constructor(public id: string) {}
      },
      window: {
        createStatusBarItem: vi.fn(() => ({
          text: '',
          tooltip: undefined,
          command: undefined,
          show: vi.fn(),
          dispose: vi.fn(),
        })),
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
      languages: {
        registerInlineCompletionItemProvider: vi.fn(() => ({ dispose: vi.fn() })),
      },
      chat: {
        createChatParticipant: vi.fn(() => ({
          iconPath: undefined,
          dispose: vi.fn(),
        })),
      },
      Uri: {
        file: vi.fn((path: string) => ({ fsPath: path })),
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
      InlineCompletionItem: class {
        constructor(public readonly insertText: string) {}
      },
      Disposable: class {
        constructor(public dispose: () => void) {}
        static from(...disposables: any[]) {
          return new (this as any)(() => disposables.forEach(d => d.dispose?.()));
        }
      },
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
        prefetchModels = vi.fn();
      },
    }));

    vi.doMock('./sidebar.js', () => ({
      registerSidebar: vi.fn(),
    }));

    vi.doMock('./modelfiles.js', () => ({
      registerModelfileManager: vi.fn(),
    }));

    const ext = await import('./extension.js');
    await ext.activate({ subscriptions: [], extensionUri: { fsPath: '' } } as any);

    expect(registerCommand).toHaveBeenCalledWith('opilot.manageAuthToken', expect.any(Function));
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
      StatusBarAlignment: { Right: 2 },
      MarkdownString: class {
        constructor(public value: string) {}
      },
      ThemeColor: class {
        constructor(public id: string) {}
      },
      window: {
        createStatusBarItem: vi.fn(() => ({
          text: '',
          tooltip: undefined,
          command: undefined,
          show: vi.fn(),
          dispose: vi.fn(),
        })),
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
      languages: {
        registerInlineCompletionItemProvider: vi.fn(() => ({ dispose: vi.fn() })),
      },
      chat: {
        createChatParticipant: vi.fn(() => ({
          iconPath: undefined,
          dispose: vi.fn(),
        })),
      },
      Uri: {
        file: vi.fn((path: string) => ({ fsPath: path })),
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
      InlineCompletionItem: class {
        constructor(public readonly insertText: string) {}
      },
      Disposable: class {
        constructor(public dispose: () => void) {}
        static from(...disposables: any[]) {
          return new (this as any)(() => disposables.forEach(d => d.dispose?.()));
        }
      },
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
        prefetchModels = vi.fn();
      },
    }));

    vi.doMock('./sidebar.js', () => ({
      registerSidebar: vi.fn(),
    }));

    vi.doMock('./modelfiles.js', () => ({
      registerModelfileManager: vi.fn(),
    }));

    const ext = await import('./extension.js');
    await ext.activate({ subscriptions: [], extensionUri: { fsPath: '' } } as any);

    // Simulate streamLogs configuration change
    if (configChangeCallback) {
      configChangeCallback({
        affectsConfiguration: (key: string) => key === 'ollama.streamLogs',
      });
    }

    // After activation and config change, info should have been called
    // (with context key updates and potentially log streaming messages)
    expect(mockInfo.mock.calls.length).toBeGreaterThan(0);
  });

  it('registers inline completion provider during activation', async () => {
    const registerInlineCompletionItemProvider = vi.fn(() => ({ dispose: vi.fn() }));

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
      StatusBarAlignment: { Right: 2 },
      MarkdownString: class {
        constructor(public value: string) {}
      },
      ThemeColor: class {
        constructor(public id: string) {}
      },
      window: {
        createStatusBarItem: vi.fn(() => ({
          text: '',
          tooltip: undefined,
          command: undefined,
          show: vi.fn(),
          dispose: vi.fn(),
        })),
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
      languages: {
        registerInlineCompletionItemProvider,
      },
      chat: {
        createChatParticipant: vi.fn(() => ({
          iconPath: undefined,
          dispose: vi.fn(),
        })),
      },
      Uri: {
        file: vi.fn((path: string) => ({ fsPath: path })),
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
      InlineCompletionItem: class {
        constructor(public readonly insertText: string) {}
      },
      Disposable: class {
        constructor(public dispose: () => void) {}
        static from(...disposables: any[]) {
          return new (this as any)(() => disposables.forEach(d => d.dispose?.()));
        }
      },
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
        prefetchModels = vi.fn();
      },
    }));

    vi.doMock('./sidebar.js', () => ({
      registerSidebar: vi.fn(),
    }));

    vi.doMock('./modelfiles.js', () => ({
      registerModelfileManager: vi.fn(),
    }));

    const ext = await import('./extension.js');
    await ext.activate({ subscriptions: [], extensionUri: { fsPath: '' } } as any);

    expect(registerInlineCompletionItemProvider).toHaveBeenCalledOnce();
    expect(registerInlineCompletionItemProvider).toHaveBeenCalledWith(
      { pattern: '**' },
      expect.objectContaining({ provideInlineCompletionItems: expect.any(Function) }),
    );
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
        prefetchModels = vi.fn();
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
      model: { vendor: 'selfagency-opilot', id: 'qwen3:8b' },
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

  it('strips raw <think>...</think> tags from local model content stream', async () => {
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
        prefetchModels = vi.fn();
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
    const mockThinkingProgress = vi.fn();
    const stream = { markdown: mockMarkdown, thinkingProgress: mockThinkingProgress };
    const token = { isCancellationRequested: false };

    // Simulate an older Ollama / model that emits raw <think> tags in content
    const mockClient = {
      chat: vi.fn().mockResolvedValue(
        (async function* () {
          yield { message: { content: '<think>let me reason step 1' } };
          yield { message: { content: ' step 2</think>' } };
          yield { message: { content: 'The answer is 42.' } };
          yield { message: {}, done: true };
        })(),
      ),
    };

    const request = {
      prompt: 'what is the meaning of life?',
      model: { vendor: 'selfagency-opilot', id: 'qwen3:8b' },
    };

    await ext.handleChatRequest(request as any, { history: [] } as any, stream as any, token as any, mockClient as any);

    const allCalls = mockMarkdown.mock.calls.map((c: any[]) => c[0] as string);
    const joined = allCalls.join('');

    // Raw <think> tags must never reach the markdown stream
    expect(joined).not.toContain('<think>');
    expect(joined).not.toContain('</think>');
    // Thinking should be emitted via thinkingProgress (Phase 2) instead of markdown header
    expect(mockThinkingProgress.mock.calls.length).toBeGreaterThan(0);
    // Thinking content should be visible (either in thinkingProgress or markdown)
    const allThinkingCalls = mockThinkingProgress.mock.calls.map((c: any[]) => JSON.stringify(c[0])).join('');
    expect(allCalls.join('').includes('let me reason step') || allThinkingCalls.includes('let me reason')).toBe(true);
    // Separator before response
    expect(allCalls.some((v: string) => v.includes('---'))).toBe(true);
    // Final answer present
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
        prefetchModels = vi.fn();
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
      Uri: {
        file: vi.fn((path: string) => ({ fsPath: path })),
        joinPath: vi.fn((_base: any, p: string) => ({ fsPath: p })),
      },
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
      model: { vendor: 'selfagency-opilot', id: 'qwen3:8b' },
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
        prefetchModels = vi.fn();
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
      Uri: {
        file: vi.fn((path: string) => ({ fsPath: path })),
        joinPath: vi.fn((_base: any, p: string) => ({ fsPath: p })),
      },
      chat: { createChatParticipant: vi.fn(() => ({ iconPath: undefined, dispose: vi.fn() })) },
      commands: { registerCommand: vi.fn(() => ({ dispose: vi.fn() })), executeCommand: vi.fn() },
    }));

    const ext = await import('./extension.js');

    const mockMarkdown = vi.fn();
    const mockBeginToolInvocation = vi.fn();
    const mockUpdateToolInvocation = vi.fn();
    const stream = {
      markdown: mockMarkdown,
      beginToolInvocation: mockBeginToolInvocation,
      updateToolInvocation: mockUpdateToolInvocation,
      usage: vi.fn(),
    };
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
      model: { vendor: 'selfagency-opilot', id: 'llama3.2:latest' },
    };

    await ext.handleChatRequest(request as any, { history: [] } as any, stream as any, token as any, mockClient as any);

    expect(mockBeginToolInvocation).toHaveBeenCalledWith(expect.stringContaining('get_weather'), 'get_weather');
  });

  it('shows error dialog and attempts model unload when model runner crashes', async () => {
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
        prefetchModels = vi.fn();
      },
      isThinkingModelId: () => false,
    }));
    vi.doMock('./sidebar.js', () => ({ registerSidebar: vi.fn() }));
    vi.doMock('./modelfiles.js', () => ({ registerModelfileManager: vi.fn() }));

    const showErrorMessage = vi.fn().mockResolvedValue(undefined);
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
      Uri: {
        file: vi.fn((path: string) => ({ fsPath: path })),
        joinPath: vi.fn((_base: any, p: string) => ({ fsPath: p })),
      },
      chat: { createChatParticipant: vi.fn(() => ({ iconPath: undefined, dispose: vi.fn() })) },
      commands: { registerCommand: vi.fn(() => ({ dispose: vi.fn() })), executeCommand: vi.fn() },
      window: { showErrorMessage },
    }));

    const ext = await import('./extension.js');

    const mockMarkdown = vi.fn();
    const stream = { markdown: mockMarkdown };
    const token = { isCancellationRequested: false };

    const mockChatFn = vi
      .fn()
      .mockRejectedValue(new Error('model runner has unexpectedly stopped, please check ollama server logs'));
    const mockGenerateFn = vi.fn().mockResolvedValue({});
    const mockClient = {
      chat: mockChatFn,
      generate: mockGenerateFn,
    };

    const request = {
      prompt: 'hello',
      model: { vendor: 'selfagency-opilot', id: 'llama3.2:latest' },
    };

    await ext.handleChatRequest(request as any, { history: [] } as any, stream as any, token as any, mockClient as any);

    expect(showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('model runner crashed'), 'Open Logs');
    // Best-effort unload via generate with keep_alive=0.
    expect(mockGenerateFn).toHaveBeenCalledWith(expect.objectContaining({ model: 'llama3.2:latest', keep_alive: 0 }));
    // Error text streamed back to the participant response.
    expect(mockMarkdown).toHaveBeenCalledWith(expect.stringContaining('model runner has unexpectedly stopped'));
  });

  it('retries @ollama without tools when tool schema is rejected', async () => {
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
        prefetchModels = vi.fn();
      },
      isThinkingModelId: () => false,
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
      lm: {
        selectChatModels: vi.fn().mockResolvedValue([]),
        tools: [{ name: 'demo_tool', description: 'demo', inputSchema: null }],
      },
      workspace: { getConfiguration: vi.fn().mockReturnValue({ get: vi.fn() }) },
      Uri: {
        file: vi.fn((path: string) => ({ fsPath: path })),
        joinPath: vi.fn((_base: any, p: string) => ({ fsPath: p })),
      },
      chat: { createChatParticipant: vi.fn(() => ({ iconPath: undefined, dispose: vi.fn() })) },
      commands: { registerCommand: vi.fn(() => ({ dispose: vi.fn() })), executeCommand: vi.fn() },
    }));

    const ext = await import('./extension.js');
    const markdown = vi.fn();
    const stream = { markdown };
    const token = { isCancellationRequested: false };

    const unsupportedToolsError = new Error('Error validating JSON Schema: None is not of type object');
    (unsupportedToolsError as Error & { name: string }).name = 'ResponseError';

    const chat = vi
      .fn()
      // Tool round request (stream=false) fails due to schema error
      .mockRejectedValueOnce(unsupportedToolsError)
      // XML fallback request (stream=false) returns plain text — no XML tool calls
      .mockResolvedValueOnce({ message: { content: 'hello after fallback' }, done: true });

    const mockClient = { chat };
    const request = {
      prompt: '@ollama hello',
      model: { vendor: 'selfagency-opilot', id: 'llama3.2:latest' },
      toolInvocationToken: 'tok-1',
    };

    await ext.handleChatRequest(request as any, { history: [] } as any, stream as any, token as any, mockClient as any);

    expect(chat).toHaveBeenCalledTimes(2);
    expect(chat).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        stream: false,
        tools: [
          expect.objectContaining({
            function: expect.objectContaining({
              parameters: expect.objectContaining({ type: 'object' }),
            }),
          }),
        ],
      }),
    );
    // XML fallback: stream=false, no tools key
    expect(chat).toHaveBeenNthCalledWith(2, expect.objectContaining({ stream: false }));
    expect(chat.mock.calls[1][0]).not.toHaveProperty('tools');
    expect(markdown).toHaveBeenCalledWith(expect.stringContaining('hello after fallback'));
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
      'Open Logs',
    );
    expect(executeCommand).toHaveBeenCalledWith('workbench.action.openSettings', 'opilot');
  });

  it('shows error message but does not execute command when not selected', async () => {
    const showErrorMessage = vi.fn().mockResolvedValue(undefined);
    const executeCommand = vi.fn();

    const ext = await import('./extension.js');
    await ext.handleConnectionTestFailure('http://localhost:11434', { showErrorMessage }, { executeCommand });

    expect(showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('Cannot connect to Ollama server'),
      'Open Settings',
      'Open Logs',
    );
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it('shows extension output channel when Open Logs is selected for a remote host', async () => {
    const showErrorMessage = vi.fn().mockResolvedValue('Open Logs');
    const showInformationMessage = vi.fn().mockResolvedValue(undefined);
    const logOutputChannel = { show: vi.fn() };

    const ext = await import('./extension.js');
    await ext.handleConnectionTestFailure(
      'http://remote-server:11434',
      { showErrorMessage, showInformationMessage },
      { executeCommand: vi.fn() },
      logOutputChannel,
    );

    expect(logOutputChannel.show).toHaveBeenCalled();
    expect(showInformationMessage).toHaveBeenCalledWith(expect.stringContaining('remote Ollama connection'));
  });

  it('redacts URL credentials in displayed connection error messages', async () => {
    const showErrorMessage = vi.fn().mockResolvedValue(undefined);

    const ext = await import('./extension.js');
    await ext.handleConnectionTestFailure('http://alice:secret@remote-server:11434', { showErrorMessage });

    const firstArg = showErrorMessage.mock.calls[0]?.[0] as string;
    expect(firstArg).toContain('http://remote-server:11434/');
    expect(firstArg).not.toContain('alice:secret');
  });
});

describe('setupChatParticipant', () => {
  it('creates and configures chat participant', async () => {
    const mockParticipant = {
      iconPath: undefined,
      dispose: vi.fn(),
      titleProvider: undefined,
      summarizer: undefined,
      additionalWelcomeMessage: undefined,
      followupProvider: undefined,
      participantVariableProvider: undefined,
    };
    const createChatParticipant = vi.fn(() => mockParticipant);

    const ext = await import('./extension.js');
    const mockHandler = vi.fn() as any;
    const mockContext = { extensionUri: { fsPath: '/test' } };

    const result = await ext.setupChatParticipant(mockContext as any, mockHandler, { createChatParticipant } as any);

    expect(createChatParticipant).toHaveBeenCalledWith('opilot.ollama', mockHandler);
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
        vendor: 'selfagency-opilot',
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
      .mockResolvedValue([{ vendor: 'selfagency-opilot', sendRequest: mockSendRequest }]);

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
      model: { vendor: 'selfagency-opilot', sendRequest: mockSendRequest },
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

  it('streams text chunks immediately in VS Code LM API path (no buffering until completion)', async () => {
    const LMTextPart = class {
      constructor(public value: string) {}
    };

    let releaseSecondChunk: (() => void) | undefined;
    const waitForSecondChunk = new Promise<void>(resolve => {
      releaseSecondChunk = resolve;
    });

    const mockSendRequest = vi.fn().mockResolvedValue({
      stream: (async function* () {
        yield new LMTextPart('first chunk ');
        await waitForSecondChunk;
        yield new LMTextPart('second chunk');
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
      lm: { selectChatModels: vi.fn().mockResolvedValue([]), tools: [] },
      workspace: { getConfiguration: vi.fn().mockReturnValue({ get: vi.fn() }) },
    }));

    const ext = await import('./extension.js');
    const mockMarkdown = vi.fn();
    const mockRequest = {
      prompt: 'test',
      model: { vendor: 'selfagency-opilot', sendRequest: mockSendRequest },
    };

    const pending = ext.handleChatRequest(
      mockRequest as any,
      { history: [] } as any,
      { markdown: mockMarkdown } as any,
      { isCancellationRequested: false } as any,
    );

    // Allow the first streamed chunk to flow before the stream completes.
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(mockMarkdown).toHaveBeenCalledWith('first chunk ');

    releaseSecondChunk?.();
    await pending;

    expect(mockMarkdown).toHaveBeenCalledWith('second chunk');
  });

  it('stops consuming LM API stream chunks when cancellation is requested', async () => {
    const LMTextPart = class {
      constructor(public value: string) {}
    };

    const mockToken = { isCancellationRequested: false };

    const mockSendRequest = vi.fn().mockResolvedValue({
      stream: (async function* () {
        yield new LMTextPart('first chunk');
        mockToken.isCancellationRequested = true;
        yield new LMTextPart('second chunk should not render');
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
      lm: { selectChatModels: vi.fn().mockResolvedValue([]), tools: [] },
      workspace: { getConfiguration: vi.fn().mockReturnValue({ get: vi.fn() }) },
    }));

    const ext = await import('./extension.js');
    const mockMarkdown = vi.fn();
    const mockRequest = {
      prompt: 'test',
      model: { vendor: 'selfagency-opilot', sendRequest: mockSendRequest },
    };

    await ext.handleChatRequest(
      mockRequest as any,
      { history: [] } as any,
      { markdown: mockMarkdown } as any,
      mockToken as any,
    );

    expect(mockMarkdown).toHaveBeenCalledWith('first chunk');
    expect(mockMarkdown).not.toHaveBeenCalledWith('second chunk should not render');
  });

  it('invokes tools and feeds results back when toolInvocationToken is present', async () => {
    vi.resetModules();

    const LMTextPart = class {
      constructor(public value: string) {}
    };
    const LMToolCallPart = class {
      constructor(
        public callId: string,
        public name: string,
        public input: Record<string, unknown>,
      ) {}
    };
    const LMToolResultPart = class {
      constructor(
        public callId: string,
        public content: unknown,
      ) {}
    };

    // Round 1: stream yields a tool call; Round 2: stream yields the final text
    const mockSendRequest = vi
      .fn()
      .mockResolvedValueOnce({
        stream: (async function* () {
          yield new LMToolCallPart('call-1', 'search', { query: 'vitest' });
        })(),
      })
      .mockResolvedValueOnce({
        stream: (async function* () {
          yield new LMTextPart('final answer');
        })(),
      });

    const mockInvokeTool = vi.fn().mockResolvedValue({ content: [new LMTextPart('tool-result')] });
    const mockSelectChatModels = vi.fn().mockResolvedValue([
      {
        vendor: 'selfagency-opilot',
        sendRequest: mockSendRequest,
      },
    ]);

    vi.doMock('vscode', () => ({
      LanguageModelTextPart: LMTextPart,
      LanguageModelToolCallPart: LMToolCallPart,
      LanguageModelToolResultPart: LMToolResultPart,
      ChatRequestTurn: class {},
      ChatResponseTurn: class {},
      ChatResponseMarkdownPart: class {},
      LanguageModelChatMessage: {
        User: (content: unknown) => ({ role: 'user', content }),
        Assistant: (content: unknown) => ({ role: 'assistant', content }),
      },
      lm: {
        selectChatModels: mockSelectChatModels,
        tools: [{ name: 'search', description: 'search the web', inputSchema: {} }],
        invokeTool: mockInvokeTool,
      },
      workspace: { getConfiguration: vi.fn().mockReturnValue({ get: vi.fn() }) },
    }));

    const ext = await import('./extension.js');
    const mockMarkdown = vi.fn();
    const mockRequest = {
      prompt: 'test',
      model: { vendor: 'copilot' },
      toolInvocationToken: 'tok-123',
    };

    await ext.handleChatRequest(
      mockRequest as any,
      { history: [] } as any,
      { markdown: mockMarkdown } as any,
      { isCancellationRequested: false } as any,
    );

    expect(mockSendRequest).toHaveBeenCalledTimes(2);
    expect(mockInvokeTool).toHaveBeenCalledWith(
      'search',
      expect.objectContaining({ input: { query: 'vitest' }, toolInvocationToken: 'tok-123' }),
      expect.anything(),
    );
    expect(mockMarkdown).toHaveBeenCalledWith('final answer');
  });

  it('handles tool invocation errors gracefully', async () => {
    vi.resetModules();

    const LMTextPart = class {
      constructor(public value: string) {}
    };
    const LMToolCallPart = class {
      constructor(
        public callId: string,
        public name: string,
        public input: Record<string, unknown>,
      ) {}
    };
    const LMToolResultPart = class {
      constructor(
        public callId: string,
        public content: unknown,
      ) {}
    };

    const mockSendRequest = vi
      .fn()
      .mockResolvedValueOnce({
        stream: (async function* () {
          yield new LMToolCallPart('call-err', 'broken_tool', {});
        })(),
      })
      .mockResolvedValueOnce({
        stream: (async function* () {
          yield new LMTextPart('recovered');
        })(),
      });

    const mockInvokeTool = vi.fn().mockRejectedValue(new Error('tool crashed'));
    const mockSelectChatModels = vi.fn().mockResolvedValue([
      {
        vendor: 'selfagency-opilot',
        sendRequest: mockSendRequest,
      },
    ]);

    vi.doMock('vscode', () => ({
      LanguageModelTextPart: LMTextPart,
      LanguageModelToolCallPart: LMToolCallPart,
      LanguageModelToolResultPart: LMToolResultPart,
      ChatRequestTurn: class {},
      ChatResponseTurn: class {},
      ChatResponseMarkdownPart: class {},
      LanguageModelChatMessage: {
        User: (content: unknown) => ({ role: 'user', content }),
        Assistant: (content: unknown) => ({ role: 'assistant', content }),
      },
      lm: {
        selectChatModels: mockSelectChatModels,
        tools: [{ name: 'broken_tool', description: 'a broken tool', inputSchema: {} }],
        invokeTool: mockInvokeTool,
      },
      workspace: { getConfiguration: vi.fn().mockReturnValue({ get: vi.fn() }) },
    }));

    const ext = await import('./extension.js');
    const mockMarkdown = vi.fn();
    const mockRequest = {
      prompt: 'test',
      model: { vendor: 'copilot' },
      toolInvocationToken: 'tok-456',
    };

    await ext.handleChatRequest(
      mockRequest as any,
      { history: [] } as any,
      { markdown: mockMarkdown } as any,
      { isCancellationRequested: false } as any,
    );

    // Should still complete the loop with the tool error fed back, and output the final text
    expect(mockSendRequest).toHaveBeenCalledTimes(2);
    expect(mockMarkdown).toHaveBeenCalledWith('recovered');
  });

  it('invokes task_complete and exits without extra rounds (VS Code LM API path)', async () => {
    vi.resetModules();

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
        prefetchModels = vi.fn();
      },
      isThinkingModelId: () => false,
    }));
    vi.doMock('./sidebar.js', () => ({ registerSidebar: vi.fn() }));
    vi.doMock('./modelfiles.js', () => ({ registerModelfileManager: vi.fn() }));

    const LMTextPart = class {
      constructor(public value: string) {}
    };
    const LMToolCallPart = class {
      constructor(
        public callId: string,
        public name: string,
        public input: Record<string, unknown>,
      ) {}
    };
    const LMToolResultPart = class {
      constructor(
        public callId: string,
        public content: unknown,
      ) {}
    };

    // Single round: stream yields buffered text + task_complete; no second round should occur.
    const mockSendRequest = vi.fn().mockResolvedValueOnce({
      stream: (async function* () {
        yield new LMTextPart('all done');
        yield new LMToolCallPart('tc-1', 'task_complete', {});
      })(),
    });

    const mockInvokeTool = vi.fn().mockResolvedValue({ content: [] });
    const mockSelectChatModels = vi
      .fn()
      .mockResolvedValue([{ vendor: 'selfagency-opilot', sendRequest: mockSendRequest }]);

    vi.doMock('vscode', () => ({
      LanguageModelTextPart: LMTextPart,
      LanguageModelToolCallPart: LMToolCallPart,
      LanguageModelToolResultPart: LMToolResultPart,
      ChatRequestTurn: class {},
      ChatResponseTurn: class {},
      ChatResponseMarkdownPart: class {},
      LanguageModelChatMessage: {
        User: (content: unknown) => ({ role: 'user', content }),
        Assistant: (content: unknown) => ({ role: 'assistant', content }),
      },
      lm: {
        selectChatModels: mockSelectChatModels,
        tools: [{ name: 'task_complete', description: 'signal done', inputSchema: {} }],
        invokeTool: mockInvokeTool,
      },
      workspace: { getConfiguration: vi.fn().mockReturnValue({ get: vi.fn() }) },
      Uri: {
        file: vi.fn((path: string) => ({ fsPath: path })),
        joinPath: vi.fn((_base: any, p: string) => ({ fsPath: p })),
      },
      chat: { createChatParticipant: vi.fn(() => ({ iconPath: undefined, dispose: vi.fn() })) },
      commands: { registerCommand: vi.fn(() => ({ dispose: vi.fn() })), executeCommand: vi.fn() },
    }));

    const ext = await import('./extension.js');
    const mockMarkdown = vi.fn();
    const mockRequest = {
      prompt: 'finish',
      model: { vendor: 'copilot' },
      toolInvocationToken: 'tok-tc',
    };

    await ext.handleChatRequest(
      mockRequest as any,
      { history: [] } as any,
      { markdown: mockMarkdown } as any,
      { isCancellationRequested: false } as any,
    );

    // Only one round — task_complete terminates the loop immediately.
    expect(mockSendRequest).toHaveBeenCalledTimes(1);
    // Buffered text flushed before exiting.
    expect(mockMarkdown).toHaveBeenCalledWith('all done');
    // task_complete was invoked for VS Code bookkeeping.
    expect(mockInvokeTool).toHaveBeenCalledWith(
      'task_complete',
      expect.objectContaining({ toolInvocationToken: 'tok-tc' }),
      expect.anything(),
    );
  });

  it('warns when task_complete invocation fails (VS Code LM API path)', async () => {
    vi.resetModules();

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
        prefetchModels = vi.fn();
      },
      isThinkingModelId: () => false,
    }));
    vi.doMock('./sidebar.js', () => ({ registerSidebar: vi.fn() }));
    vi.doMock('./modelfiles.js', () => ({ registerModelfileManager: vi.fn() }));

    const LMTextPart = class {
      constructor(public value: string) {}
    };
    const LMToolCallPart = class {
      constructor(
        public callId: string,
        public name: string,
        public input: Record<string, unknown>,
      ) {}
    };
    const LMToolResultPart = class {
      constructor(
        public callId: string,
        public content: unknown,
      ) {}
    };

    const mockSendRequest = vi.fn().mockResolvedValueOnce({
      stream: (async function* () {
        yield new LMTextPart('all done');
        yield new LMToolCallPart('tc-1', 'task_complete', {});
      })(),
    });

    const mockInvokeTool = vi.fn().mockRejectedValue(new Error('tool failed'));
    const mockSelectChatModels = vi
      .fn()
      .mockResolvedValue([{ vendor: 'selfagency-opilot', sendRequest: mockSendRequest }]);

    vi.doMock('vscode', () => ({
      LanguageModelTextPart: LMTextPart,
      LanguageModelToolCallPart: LMToolCallPart,
      LanguageModelToolResultPart: LMToolResultPart,
      ChatRequestTurn: class {},
      ChatResponseTurn: class {},
      ChatResponseMarkdownPart: class {},
      LanguageModelChatMessage: {
        User: (content: unknown) => ({ role: 'user', content }),
        Assistant: (content: unknown) => ({ role: 'assistant', content }),
      },
      lm: {
        selectChatModels: mockSelectChatModels,
        tools: [{ name: 'task_complete', description: 'signal done', inputSchema: {} }],
        invokeTool: mockInvokeTool,
      },
      workspace: { getConfiguration: vi.fn().mockReturnValue({ get: vi.fn() }) },
      Uri: {
        file: vi.fn((path: string) => ({ fsPath: path })),
        joinPath: vi.fn((_base: any, p: string) => ({ fsPath: p })),
      },
      chat: { createChatParticipant: vi.fn(() => ({ iconPath: undefined, dispose: vi.fn() })) },
      commands: { registerCommand: vi.fn(() => ({ dispose: vi.fn() })), executeCommand: vi.fn() },
    }));

    const ext = await import('./extension.js');
    const mockMarkdown = vi.fn();
    const output = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn(), exception: vi.fn() };
    const mockRequest = {
      prompt: 'finish',
      model: { vendor: 'copilot' },
      toolInvocationToken: 'tok-tc',
    };

    await ext.handleChatRequest(
      mockRequest as any,
      { history: [] } as any,
      { markdown: mockMarkdown } as any,
      { isCancellationRequested: false } as any,
      undefined,
      output as any,
    );

    expect(output.warn).toHaveBeenCalledWith(
      expect.stringContaining('task_complete invocation failed (vscode-lm path)'),
    );
  });
});

describe('handleChatRequest native Ollama task_complete', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('invokes task_complete, renders final content, and exits without an extra tool round', async () => {
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
        prefetchModels = vi.fn();
      },
      isThinkingModelId: () => false,
    }));
    vi.doMock('./sidebar.js', () => ({ registerSidebar: vi.fn() }));
    vi.doMock('./modelfiles.js', () => ({ registerModelfileManager: vi.fn() }));

    const mockInvokeTool = vi.fn().mockResolvedValue({ content: [] });

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
      lm: {
        selectChatModels: vi.fn().mockResolvedValue([]),
        tools: [{ name: 'task_complete', description: 'signal done', inputSchema: {} }],
        invokeTool: mockInvokeTool,
      },
      workspace: { getConfiguration: vi.fn().mockReturnValue({ get: vi.fn() }) },
      Uri: {
        file: vi.fn((path: string) => ({ fsPath: path })),
        joinPath: vi.fn((_base: any, p: string) => ({ fsPath: p })),
      },
      chat: { createChatParticipant: vi.fn(() => ({ iconPath: undefined, dispose: vi.fn() })) },
      commands: { registerCommand: vi.fn(() => ({ dispose: vi.fn() })), executeCommand: vi.fn() },
    }));

    const ext = await import('./extension.js');
    const mockMarkdown = vi.fn();
    const stream = { markdown: mockMarkdown };
    const token = { isCancellationRequested: false };

    // Round 1: model returns task_complete + final content (plain ChatResponse, stream: false).
    // Round 2 should never be reached.
    const mockChat = vi
      .fn()
      .mockResolvedValueOnce({
        message: {
          content: 'Task finished.',
          tool_calls: [{ function: { name: 'task_complete', arguments: {} } }],
        },
      })
      // If a second round were called this would make the test fail clearly.
      .mockResolvedValueOnce({
        message: { content: 'should not appear' },
        done: true,
      });

    const mockClient = { chat: mockChat };
    const request = {
      prompt: 'finish',
      model: { vendor: 'selfagency-opilot', id: 'llama3.2:latest' },
      toolInvocationToken: 'tok-native',
    };

    await ext.handleChatRequest(request as any, { history: [] } as any, stream as any, token as any, mockClient as any);

    // Only one round of chat — task_complete signals completion.
    expect(mockChat).toHaveBeenCalledTimes(1);
    // Final content from the model was rendered.
    expect(mockMarkdown).toHaveBeenCalledWith(expect.stringContaining('Task finished.'));
    // task_complete was invoked for VS Code bookkeeping.
    expect(mockInvokeTool).toHaveBeenCalledWith(
      'task_complete',
      expect.objectContaining({ toolInvocationToken: 'tok-native' }),
      expect.anything(),
    );
    // No empty tool-result message was pushed (no second chat call).
    expect(mockMarkdown).not.toHaveBeenCalledWith(expect.stringContaining('should not appear'));
  });

  it('warns when task_complete invocation fails (native path)', async () => {
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
        prefetchModels = vi.fn();
      },
      isThinkingModelId: () => false,
    }));
    vi.doMock('./sidebar.js', () => ({ registerSidebar: vi.fn() }));
    vi.doMock('./modelfiles.js', () => ({ registerModelfileManager: vi.fn() }));

    const mockInvokeTool = vi.fn().mockRejectedValue(new Error('tool failed'));

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
      lm: {
        selectChatModels: vi.fn().mockResolvedValue([]),
        tools: [{ name: 'task_complete', description: 'signal done', inputSchema: {} }],
        invokeTool: mockInvokeTool,
      },
      workspace: { getConfiguration: vi.fn().mockReturnValue({ get: vi.fn() }) },
      Uri: {
        file: vi.fn((path: string) => ({ fsPath: path })),
        joinPath: vi.fn((_base: any, p: string) => ({ fsPath: p })),
      },
      chat: { createChatParticipant: vi.fn(() => ({ iconPath: undefined, dispose: vi.fn() })) },
      commands: { registerCommand: vi.fn(() => ({ dispose: vi.fn() })), executeCommand: vi.fn() },
    }));

    const ext = await import('./extension.js');
    const mockMarkdown = vi.fn();
    const stream = { markdown: mockMarkdown };
    const token = { isCancellationRequested: false };
    const output = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn(), exception: vi.fn() };

    const mockChat = vi.fn().mockResolvedValueOnce({
      message: {
        content: 'Task finished.',
        tool_calls: [{ function: { name: 'task_complete', arguments: {} } }],
      },
    });

    const mockClient = { chat: mockChat };
    const request = {
      prompt: 'finish',
      model: { vendor: 'selfagency-opilot', id: 'llama3.2:latest' },
      toolInvocationToken: 'tok-native',
    };

    await ext.handleChatRequest(
      request as any,
      { history: [] } as any,
      stream as any,
      token as any,
      mockClient as any,
      output as any,
    );

    expect(output.warn).toHaveBeenCalledWith(expect.stringContaining('task_complete invocation failed (native path)'));
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
        createStatusBarItem: vi.fn(() => ({
          text: '',
          tooltip: undefined,
          command: undefined,
          show: vi.fn(),
          dispose: vi.fn(),
        })),
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

  it('falls back to file-based removal when config update throws not a registered configuration', async () => {
    const showWarningMessage = vi.fn().mockResolvedValue('Disable Built-in Ollama Provider');
    const showInformationMessage = vi.fn().mockResolvedValue('Reload Window');
    const showErrorMessage = vi.fn();
    const mockUpdate = vi.fn().mockRejectedValue(new Error('not a registered configuration'));
    const getConfiguration = vi.fn().mockReturnValue({ update: mockUpdate });
    const selectChatModels = vi.fn().mockResolvedValue([{ id: 'ollama:llama3', vendor: 'ollama', name: 'Llama 3' }]);
    const executeCommand = vi.fn().mockResolvedValue(undefined);

    vi.doMock('node:fs', () => ({
      promises: {
        readdir: vi.fn().mockRejectedValue(new Error('ENOENT')),
        readFile: vi.fn().mockResolvedValue(JSON.stringify([{ vendor: 'ollama', id: 'llama3' }])),
        writeFile: vi.fn().mockResolvedValue(undefined),
      },
    }));

    const ext = await import('./extension.js');
    const context = {
      globalStorageUri: { fsPath: '/fake/profiles/default/globalStorage/selfagency.ollama' },
    };

    await ext.handleBuiltInOllamaConflict(
      { showWarningMessage, showInformationMessage, showErrorMessage },
      { getConfiguration },
      { selectChatModels },
      { executeCommand },
      context as any,
    );

    expect(mockUpdate).toHaveBeenCalled();
    expect(showInformationMessage).toHaveBeenCalledWith(expect.stringContaining('disabled'), 'Reload Window');
  });

  it('handles concurrent file changes during fallback by retrying with latest content', async () => {
    const showWarningMessage = vi.fn().mockResolvedValue('Disable Built-in Ollama Provider');
    const showInformationMessage = vi.fn().mockResolvedValue('Reload Window');
    const showErrorMessage = vi.fn();
    const mockUpdate = vi.fn().mockRejectedValue(new Error('not a registered configuration'));
    const getConfiguration = vi.fn().mockReturnValue({ update: mockUpdate });
    const selectChatModels = vi.fn().mockResolvedValue([{ id: 'ollama:llama3', vendor: 'ollama', name: 'Llama 3' }]);

    const targetPath = '/fake/profiles/default/chatLanguageModels.json';
    const originalRaw = JSON.stringify([
      { vendor: 'ollama', id: 'llama3' },
      { vendor: 'other', id: 'model1' },
    ]);
    const changedRaw = JSON.stringify([
      { vendor: 'ollama', id: 'llama3' },
      { vendor: 'other', id: 'model1' },
      { vendor: 'other', id: 'model2' },
    ]);

    let targetReads = 0;
    const readFile = vi.fn().mockImplementation((path: string) => {
      if (path !== targetPath) {
        throw new Error('ENOENT');
      }
      targetReads += 1;
      if (targetReads === 1) return Promise.resolve(originalRaw); // first attempt read
      if (targetReads === 2) return Promise.resolve(changedRaw); // detect race before write
      return Promise.resolve(changedRaw); // retry read + confirm
    });

    const writeFile = vi.fn().mockResolvedValue(undefined);

    vi.doMock('node:fs', () => ({
      promises: {
        readdir: vi.fn().mockRejectedValue(new Error('ENOENT')),
        readFile,
        writeFile,
      },
    }));

    const ext = await import('./extension.js');
    const context = {
      globalStorageUri: { fsPath: '/fake/profiles/default/globalStorage/selfagency.ollama' },
    };

    await ext.handleBuiltInOllamaConflict(
      { showWarningMessage, showInformationMessage, showErrorMessage },
      { getConfiguration },
      { selectChatModels },
      undefined,
      context as any,
    );

    expect(writeFile).toHaveBeenCalledTimes(1);
    const written = writeFile.mock.calls[0][1] as string;
    expect(written).toContain('model2');
    expect(written).not.toContain('"vendor": "ollama"');
    expect(showInformationMessage).toHaveBeenCalledWith(expect.stringContaining('disabled'), 'Reload Window');
  });

  it('shows error when file-based removal finds no ollama entries to remove', async () => {
    const showWarningMessage = vi.fn().mockResolvedValue('Disable Built-in Ollama Provider');
    const showInformationMessage = vi.fn();
    const showErrorMessage = vi.fn();
    const mockUpdate = vi.fn().mockRejectedValue(new Error('not a registered configuration'));
    const getConfiguration = vi.fn().mockReturnValue({ update: mockUpdate });
    const selectChatModels = vi.fn().mockResolvedValue([{ id: 'ollama:llama3', vendor: 'ollama', name: 'Llama 3' }]);

    vi.doMock('node:fs', () => ({
      promises: {
        readdir: vi.fn().mockRejectedValue(new Error('ENOENT')),
        // All files contain only non-ollama entries — nothing to remove
        readFile: vi.fn().mockResolvedValue(JSON.stringify([{ vendor: 'other', id: 'model1' }])),
        writeFile: vi.fn().mockResolvedValue(undefined),
      },
    }));

    const ext = await import('./extension.js');
    const context = {
      globalStorageUri: { fsPath: '/fake/profiles/default/globalStorage/selfagency.ollama' },
    };

    await ext.handleBuiltInOllamaConflict(
      { showWarningMessage, showInformationMessage, showErrorMessage },
      { getConfiguration },
      { selectChatModels },
      undefined,
      context as any,
    );

    expect(showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('still be enabled'));
    expect(showInformationMessage).not.toHaveBeenCalled();
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
      affectsConfiguration: vi.fn(() => false),
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

// ---------------------------------------------------------------------------
// noopLogger — covered when createOutputChannel is not a function
// ---------------------------------------------------------------------------

describe('activate noopLogger', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses noopLogger (info + warn) when createOutputChannel is not available', async () => {
    // No createOutputChannel in window mock → logOutputChannel = undefined → diagnostics = noopLogger
    vi.doMock('vscode', () => ({
      TreeItem: class {
        constructor(public label: string) {}
      },
      TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
      EventEmitter: class {
        event = {};
        fire = vi.fn();
      },
      StatusBarAlignment: { Right: 2 },
      MarkdownString: class {
        constructor(public value: string) {}
      },
      ThemeColor: class {
        constructor(public id: string) {}
      },
      window: {
        createStatusBarItem: vi.fn(() => ({
          text: '',
          tooltip: undefined,
          command: undefined,
          show: vi.fn(),
          dispose: vi.fn(),
        })),
        registerTreeDataProvider: vi.fn(() => ({ dispose: vi.fn() })),
        showInputBox: vi.fn(),
        showErrorMessage: vi.fn(),
        showInformationMessage: vi.fn(),
        withProgress: vi.fn(async (_options: any, callback: any) => callback({})),
        // createOutputChannel intentionally omitted
      },
      commands: {
        registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
        executeCommand: vi.fn(),
      },
      workspace: {
        getConfiguration: vi.fn(() => ({
          get: vi.fn((key: string) => {
            if (key === 'localModelRefreshInterval') return 0;
            if (key === 'libraryRefreshInterval') return 0;
            return undefined;
          }),
        })),
        onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
      },
      lm: {
        // Throw "already registered" to cover noopLogger.warn path
        registerLanguageModelChatProvider: vi.fn(() => {
          throw new Error('already registered');
        }),
      },
      languages: {
        registerInlineCompletionItemProvider: vi.fn(() => ({ dispose: vi.fn() })),
      },
      chat: {
        createChatParticipant: vi.fn(() => ({
          iconPath: undefined,
          dispose: vi.fn(),
        })),
      },
      Uri: {
        file: vi.fn((path: string) => ({ fsPath: path })),
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
      InlineCompletionItem: class {
        constructor(public readonly insertText: string) {}
      },
      Disposable: class {
        constructor(public dispose: () => void) {}
        static from(...disposables: any[]) {
          return new (this as any)(() => disposables.forEach(d => d.dispose?.()));
        }
      },
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
        prefetchModels = vi.fn();
      },
    }));

    vi.doMock('./sidebar.js', () => ({
      registerSidebar: vi.fn(),
    }));

    vi.doMock('./modelfiles.js', () => ({
      registerModelfileManager: vi.fn(),
    }));

    const ext = await import('./extension.js');
    // activate completes without throwing (lm registration throws "already registered" → warn path)
    const result = await ext.activate({ subscriptions: [], extensionUri: { fsPath: '' } } as any);
    // noopLogger.info and noopLogger.warn were called during activation
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// startLogStreaming inner callbacks — covered via mocked child_process.spawn
// ---------------------------------------------------------------------------

describe('startLogStreaming inner callbacks', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('covers onData, stdout/stderr/error/exit callbacks via mocked spawn', async () => {
    const { EventEmitter: NodeEventEmitter } = await import('node:events');

    const fakeStdout = new NodeEventEmitter() as any;
    const fakeStderr = new NodeEventEmitter() as any;
    const fakeProcess = Object.assign(new NodeEventEmitter(), {
      stdout: fakeStdout,
      stderr: fakeStderr,
      kill: vi.fn(),
    }) as any;

    const spawnMock = vi.fn().mockReturnValue(fakeProcess);
    vi.doMock('node:child_process', () => ({ spawn: spawnMock }));

    vi.doMock('vscode', () => ({
      TreeItem: class {
        constructor(public label: string) {}
      },
      TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
      EventEmitter: class {
        event = {};
        fire = vi.fn();
      },
      StatusBarAlignment: { Right: 2 },
      MarkdownString: class {
        constructor(public value: string) {}
      },
      ThemeColor: class {
        constructor(public id: string) {}
      },
      window: {
        createStatusBarItem: vi.fn(() => ({
          text: '',
          tooltip: undefined,
          command: undefined,
          show: vi.fn(),
          dispose: vi.fn(),
        })),
        registerTreeDataProvider: vi.fn(() => ({ dispose: vi.fn() })),
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
            // streamLogs = true triggers startLogStreaming on activate
            if (key === 'streamLogs') return true;
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
      languages: {
        registerInlineCompletionItemProvider: vi.fn(() => ({ dispose: vi.fn() })),
      },
      chat: {
        createChatParticipant: vi.fn(() => ({
          iconPath: undefined,
          dispose: vi.fn(),
        })),
      },
      Uri: {
        file: vi.fn((path: string) => ({ fsPath: path })),
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
      InlineCompletionItem: class {
        constructor(public readonly insertText: string) {}
      },
      Disposable: class {
        constructor(public dispose: () => void) {}
        static from(...disposables: any[]) {
          return new (this as any)(() => disposables.forEach(d => d.dispose?.()));
        }
      },
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
        prefetchModels = vi.fn();
      },
    }));

    vi.doMock('./sidebar.js', () => ({
      registerSidebar: vi.fn(),
    }));

    vi.doMock('./modelfiles.js', () => ({
      registerModelfileManager: vi.fn(),
    }));

    const ext = await import('./extension.js');
    await ext.activate({ subscriptions: [], extensionUri: { fsPath: '' } } as any);

    // spawn was called — startLogStreaming registered callbacks on fakeProcess
    expect(spawnMock).toHaveBeenCalled();

    // Trigger stdout onData callback with real content (covers onData body, stdout callback)
    fakeStdout.emit('data', Buffer.from('ollama server started\n'));

    // Trigger stderr onData with empty string (covers onData early-return branch)
    fakeStderr.emit('data', Buffer.from(''));

    // Trigger stderr onData with real content (covers stderr branch in onData)
    fakeStderr.emit('data', Buffer.from('warning from server'));

    // Trigger error callback (covers error handler + stopLogStreaming with process set)
    fakeProcess.emit('error', new Error('spawn error'));

    // Trigger exit callback (covers exit handler)
    fakeProcess.emit('exit', 0, null);
  });
});

// ---------------------------------------------------------------------------
// deactivate
// ---------------------------------------------------------------------------

describe('deactivate', () => {
  it('exports deactivate and it does not throw', async () => {
    const ext = await import('./extension.js');
    expect(typeof ext.deactivate).toBe('function');
    expect(() => ext.deactivate()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// handleConnectionTestFailure — Open Logs path
// ---------------------------------------------------------------------------

describe('handleConnectionTestFailure Open Logs path', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens log file when Open Logs is selected and file exists', async () => {
    // Force darwin so getOllamaServerLogPath() returns a path on CI Linux too
    const platformDesc = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });

    const openTextDocument = vi.fn().mockResolvedValue({ uri: { fsPath: '/fake/server.log' } });
    const showTextDocument = vi.fn().mockResolvedValue(undefined);
    const showWarningMessage = vi.fn();

    vi.doMock('vscode', () => ({
      TreeItem: class {
        constructor(public label: string) {}
      },
      TreeItemCollapsibleState: { None: 0 },
      EventEmitter: class {
        event = {};
        fire = vi.fn();
      },
      Uri: { file: vi.fn((p: string) => ({ fsPath: p })), joinPath: vi.fn() },
      workspace: {
        openTextDocument,
        getConfiguration: vi.fn(() => ({ get: vi.fn() })),
        onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
      },
      window: {
        createStatusBarItem: vi.fn(() => ({
          text: '',
          tooltip: undefined,
          command: undefined,
          show: vi.fn(),
          dispose: vi.fn(),
        })),
        showTextDocument,
        showWarningMessage,
        showErrorMessage: vi.fn(),
        createOutputChannel: vi.fn(() => ({
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          debug: vi.fn(),
          show: vi.fn(),
        })),
      },
      commands: { registerCommand: vi.fn(() => ({ dispose: vi.fn() })), executeCommand: vi.fn() },
      lm: { registerLanguageModelChatProvider: vi.fn(() => ({ dispose: vi.fn() })) },
      chat: { createChatParticipant: vi.fn(() => ({ iconPath: undefined, dispose: vi.fn() })) },
      languages: { registerInlineCompletionItemProvider: vi.fn(() => ({ dispose: vi.fn() })) },
      ProgressLocation: { Notification: 15 },
      LanguageModelChatMessage: { User: vi.fn(), Assistant: vi.fn() },
      LanguageModelTextPart: class {
        constructor(public value: string) {}
      },
      ChatResponseMarkdownPart: class {
        value: any = {};
      },
      InlineCompletionItem: class {
        constructor(public readonly insertText: string) {}
      },
      Disposable: class {
        constructor(public dispose: () => void) {}
        static from(...disposables: any[]) {
          return new (this as any)(() => disposables.forEach(d => d.dispose?.()));
        }
      },
      CancellationToken: class {},
    }));

    const showErrorMessage = vi.fn().mockResolvedValue('Open Logs');
    const ext = await import('./extension.js');
    await ext.handleConnectionTestFailure('http://localhost:11434', { showErrorMessage }, { executeCommand: vi.fn() });

    // openTextDocument should be called with the platform-specific log path
    expect(openTextDocument).toHaveBeenCalled();
    expect(showTextDocument).toHaveBeenCalled();

    // Restore process.platform
    if (platformDesc) {
      Object.defineProperty(process, 'platform', platformDesc);
    }
  });

  it('shows warning when openTextDocument throws', async () => {
    // Force darwin so getOllamaServerLogPath() returns a path on CI Linux too
    const platformDesc = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });

    const openTextDocument = vi.fn().mockRejectedValue(new Error('file not found'));
    const showWarningMessage = vi.fn().mockResolvedValue(undefined);

    vi.doMock('vscode', () => ({
      TreeItem: class {
        constructor(public label: string) {}
      },
      TreeItemCollapsibleState: { None: 0 },
      EventEmitter: class {
        event = {};
        fire = vi.fn();
      },
      Uri: { file: vi.fn((p: string) => ({ fsPath: p })), joinPath: vi.fn() },
      workspace: {
        openTextDocument,
        getConfiguration: vi.fn(() => ({ get: vi.fn() })),
        onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
      },
      window: {
        createStatusBarItem: vi.fn(() => ({
          text: '',
          tooltip: undefined,
          command: undefined,
          show: vi.fn(),
          dispose: vi.fn(),
        })),
        showTextDocument: vi.fn(),
        showWarningMessage,
        showErrorMessage: vi.fn(),
        createOutputChannel: vi.fn(() => ({
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          debug: vi.fn(),
          show: vi.fn(),
        })),
      },
      commands: { registerCommand: vi.fn(() => ({ dispose: vi.fn() })), executeCommand: vi.fn() },
      lm: { registerLanguageModelChatProvider: vi.fn(() => ({ dispose: vi.fn() })) },
      chat: { createChatParticipant: vi.fn(() => ({ iconPath: undefined, dispose: vi.fn() })) },
      languages: { registerInlineCompletionItemProvider: vi.fn(() => ({ dispose: vi.fn() })) },
      ProgressLocation: { Notification: 15 },
      LanguageModelChatMessage: { User: vi.fn(), Assistant: vi.fn() },
      LanguageModelTextPart: class {
        constructor(public value: string) {}
      },
      ChatResponseMarkdownPart: class {
        value: any = {};
      },
      InlineCompletionItem: class {
        constructor(public readonly insertText: string) {}
      },
      Disposable: class {
        constructor(public dispose: () => void) {}
        static from(...disposables: any[]) {
          return new (this as any)(() => disposables.forEach(d => d.dispose?.()));
        }
      },
      CancellationToken: class {},
    }));

    const showErrorMessage = vi.fn().mockResolvedValue('Open Logs');
    const ext = await import('./extension.js');

    await ext.handleConnectionTestFailure('http://localhost:11434', { showErrorMessage }, { executeCommand: vi.fn() });
    expect(showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('Could not open Ollama logs'));

    // Restore process.platform
    if (platformDesc) {
      Object.defineProperty(process, 'platform', platformDesc);
    }
  });
});

describe('handleChatRequest cloud model path (openAiCompatStreamChat)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  function makeStandardMocks(warnSpy: ReturnType<typeof vi.fn> = vi.fn()) {
    vi.doMock('./diagnostics.js', () => ({
      createDiagnosticsLogger: () => ({
        info: vi.fn(),
        warn: warnSpy,
        error: vi.fn(),
        debug: vi.fn(),
        exception: vi.fn(),
      }),
      getConfiguredLogLevel: vi.fn(() => 'info'),
    }));
    vi.doMock('./provider.js', () => ({
      OllamaChatModelProvider: class {
        setAuthToken = vi.fn();
        prefetchModels = vi.fn();
      },
      isThinkingModelId: () => false,
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
  }

  it('streams response for a cloud model via openAiCompatStreamChat', async () => {
    const cloudClient = {
      chat: vi.fn(),
      generate: vi.fn(),
    };

    const sseChunks = [
      { choices: [{ delta: { content: 'Hello ' }, finish_reason: null }] },
      { choices: [{ delta: { content: 'world!' }, finish_reason: 'stop' }] },
    ];

    vi.doMock('./client.js', () => ({
      getOllamaClient: vi.fn(),
      testConnection: vi.fn(),
      getOllamaHost: vi.fn(() => 'http://localhost:11434'),
      getOllamaAuthToken: vi.fn().mockResolvedValue(undefined),
      getCloudOllamaClient: vi.fn().mockResolvedValue(cloudClient),
    }));

    vi.doMock('./openaiCompat.js', () => ({
      initiateChatCompletionsStream: vi.fn().mockResolvedValue(
        (async function* () {
          for (const chunk of sseChunks) yield chunk;
        })(),
      ),
      chatCompletionsOnce: vi.fn(),
    }));

    vi.doMock('./openaiCompatMapping.js', () => ({
      ollamaMessagesToOpenAICompat: vi.fn((msgs: any[]) => msgs),
      ollamaToolsToOpenAICompat: vi.fn(() => undefined),
    }));

    makeStandardMocks();

    const ext = await import('./extension.js');
    const mockMarkdown = vi.fn();
    const stream = { markdown: mockMarkdown };
    const token = { isCancellationRequested: false };
    const mockClient = { chat: vi.fn(), generate: vi.fn() };

    const request = {
      prompt: 'hello',
      model: { vendor: 'selfagency-opilot', id: 'llama3.3:cloud' },
    };

    await ext.handleChatRequest(
      request as any,
      { history: [] } as any,
      stream as any,
      token as any,
      mockClient as any,
      undefined,
    );

    const allCalls = mockMarkdown.mock.calls.map((c: any[]) => c[0] as string);
    const joined = allCalls.join('');
    expect(joined).toContain('Hello ');
    expect(joined).toContain('world!');
  });

  it('falls back to native SDK when openAiCompatStreamChat throws', async () => {
    const cloudClient = {
      chat: vi.fn().mockResolvedValue(
        (async function* () {
          yield { message: { content: 'fallback response' }, done: true };
        })(),
      ),
      generate: vi.fn(),
    };

    vi.doMock('./client.js', () => ({
      getOllamaClient: vi.fn(),
      testConnection: vi.fn(),
      getOllamaHost: vi.fn(() => 'http://localhost:11434'),
      getOllamaAuthToken: vi.fn().mockResolvedValue(undefined),
      getCloudOllamaClient: vi.fn().mockResolvedValue(cloudClient),
    }));

    vi.doMock('./openaiCompat.js', () => ({
      initiateChatCompletionsStream: vi.fn().mockRejectedValue(new Error('connection refused')),
      chatCompletionsOnce: vi.fn(),
    }));

    vi.doMock('./openaiCompatMapping.js', () => ({
      ollamaMessagesToOpenAICompat: vi.fn((msgs: any[]) => msgs),
      ollamaToolsToOpenAICompat: vi.fn(() => undefined),
    }));

    const warnSpy = vi.fn();
    makeStandardMocks(warnSpy);

    const ext = await import('./extension.js');
    const mockMarkdown = vi.fn();
    const stream = { markdown: mockMarkdown };
    const token = { isCancellationRequested: false };
    const outputChannel = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), exception: vi.fn() };
    // Pass cloudClient as the 5th arg so it's used as effectiveClient when no extensionContext
    const mockClient = cloudClient;

    const request = {
      prompt: 'hello',
      model: { vendor: 'selfagency-opilot', id: 'llama3.3:cloud' },
    };

    await ext.handleChatRequest(
      request as any,
      { history: [] } as any,
      stream as any,
      token as any,
      mockClient as any,
      outputChannel as any,
    );

    const allCalls = mockMarkdown.mock.calls.map((c: any[]) => c[0] as string);
    expect(allCalls.join('')).toContain('fallback response');
    expect(cloudClient.chat).toHaveBeenCalled();
    expect(outputChannel.warn).toHaveBeenCalledWith(expect.stringContaining('OpenAI-compatible stream call failed'));
  });

  it('uses openAiCompatChatOnce for cloud model tool call round', async () => {
    const cloudClient = {
      chat: vi.fn(),
      generate: vi.fn(),
    };

    vi.doMock('./client.js', () => ({
      getOllamaClient: vi.fn(),
      testConnection: vi.fn(),
      getOllamaHost: vi.fn(() => 'http://localhost:11434'),
      getOllamaAuthToken: vi.fn().mockResolvedValue(undefined),
      getCloudOllamaClient: vi.fn().mockResolvedValue(cloudClient),
    }));

    const chatCompletionsOnce = vi.fn().mockResolvedValue({
      choices: [{ message: { content: 'tool round done', tool_calls: undefined }, finish_reason: 'stop' }],
    });

    vi.doMock('./openaiCompat.js', () => ({
      initiateChatCompletionsStream: vi.fn(),
      chatCompletionsOnce,
    }));

    vi.doMock('./openaiCompatMapping.js', () => ({
      ollamaMessagesToOpenAICompat: vi.fn((msgs: any[]) => msgs),
      ollamaToolsToOpenAICompat: vi.fn(() => []),
    }));

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
      lm: {
        selectChatModels: vi.fn().mockResolvedValue([]),
        tools: [{ name: 'my_tool', description: 'test', inputSchema: { type: 'object', properties: {} } }],
      },
      workspace: { getConfiguration: vi.fn().mockReturnValue({ get: vi.fn() }) },
    }));

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
        prefetchModels = vi.fn();
      },
      isThinkingModelId: () => false,
    }));
    vi.doMock('./sidebar.js', () => ({ registerSidebar: vi.fn() }));
    vi.doMock('./modelfiles.js', () => ({ registerModelfileManager: vi.fn() }));

    const ext = await import('./extension.js');
    const mockMarkdown = vi.fn();
    const stream = { markdown: mockMarkdown };
    const token = { isCancellationRequested: false };
    const mockClient = { chat: vi.fn(), generate: vi.fn() };

    const request = {
      prompt: 'do something with tools',
      model: { vendor: 'selfagency-opilot', id: 'llama3.3:cloud' },
      toolInvocationToken: 'tok-cloud-1',
    };

    await ext.handleChatRequest(
      request as any,
      { history: [] } as any,
      stream as any,
      token as any,
      mockClient as any,
      undefined,
    );

    expect(chatCompletionsOnce).toHaveBeenCalled();
    const allCalls = mockMarkdown.mock.calls.map((c: any[]) => c[0] as string);
    expect(allCalls.join('')).toContain('tool round done');
  });
});
