import { join } from 'node:path';
import type { Ollama } from 'ollama';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// getModelfilesFolder
// ---------------------------------------------------------------------------

const minimalVscodeMock = () => ({
  TreeItem: class {
    label: string;
    collapsibleState: number;
    contextValue?: string;
    constructor(label: string, collapsibleState: number) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  },
  TreeItemCollapsibleState: { None: 0 },
  ThemeIcon: class {
    constructor(public id: string) {}
  },
  RelativePattern: class {
    constructor(
      public base: string,
      public pattern: string,
    ) {}
  },
  Uri: { file: (fsPath: string) => ({ fsPath }) },
  EventEmitter: class {
    event = {};
    fire = vi.fn();
  },
  workspace: {
    getConfiguration: vi.fn(() => ({ get: vi.fn().mockReturnValue('') })),
    onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
    createFileSystemWatcher: vi.fn(() => ({
      onDidCreate: vi.fn(),
      onDidDelete: vi.fn(),
      onDidChange: vi.fn(),
      dispose: vi.fn(),
    })),
    fs: { writeFile: vi.fn().mockResolvedValue(undefined) },
    openTextDocument: vi.fn().mockResolvedValue({}),
  },
  window: {
    showInputBox: vi.fn(),
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    showTextDocument: vi.fn(),
    withProgress: vi.fn(),
    registerTreeDataProvider: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  },
  env: {
    openExternal: vi.fn().mockResolvedValue(true),
  },
  ProgressLocation: { Notification: 15 },
  commands: { registerCommand: vi.fn().mockReturnValue({ dispose: vi.fn() }), executeCommand: vi.fn() },
  languages: {
    registerHoverProvider: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    registerCompletionItemProvider: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  },
  Hover: class {
    constructor(
      public contents: unknown,
      public range?: unknown,
    ) {}
  },
  CompletionItem: class {
    constructor(
      public label: string,
      public kind?: number,
    ) {}
  },
  CompletionItemKind: { Keyword: 13, Property: 9 },
  SnippetString: class {
    constructor(public value: string) {}
  },
  MarkdownString: class {
    constructor(public value: string) {}
  },
});

describe('getModelfilesFolder', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('vscode', minimalVscodeMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns ~/.ollama/modelfiles when setting is empty', async () => {
    const { getModelfilesFolder } = await import('./modelfiles.js');
    const config = { get: vi.fn().mockReturnValue('') };
    expect(getModelfilesFolder(config as any, '/home/user')).toBe(join('/home/user', '.ollama', 'modelfiles'));
  });

  it('returns configured path when setting is non-empty', async () => {
    const { getModelfilesFolder } = await import('./modelfiles.js');
    const config = { get: vi.fn().mockReturnValue('/custom/modelfiles') };
    expect(getModelfilesFolder(config as any, '/home/user')).toBe('/custom/modelfiles');
  });

  it('expands ~/ prefix in configured path', async () => {
    const { getModelfilesFolder } = await import('./modelfiles.js');
    const config = { get: vi.fn().mockReturnValue('~/custom/modelfiles') };
    expect(getModelfilesFolder(config as any, '/home/user')).toBe('/home/user/custom/modelfiles');
  });

  it('resolves relative configured path from workspace folder when available', async () => {
    const { getModelfilesFolder } = await import('./modelfiles.js');
    const config = { get: vi.fn().mockReturnValue('.ollama/modelfiles') };
    expect(getModelfilesFolder(config as any, '/home/user', '/workspace/project')).toBe(
      '/workspace/project/.ollama/modelfiles',
    );
  });
});

// ---------------------------------------------------------------------------
// ModelfileItem
// ---------------------------------------------------------------------------

describe('ModelfileItem', () => {
  let ModelfileItem: any;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('vscode', () => ({
      TreeItem: class {
        label: string;
        collapsibleState: number;
        contextValue?: string;
        iconPath?: unknown;
        tooltip?: string;
        command?: unknown;
        constructor(label: string, collapsibleState: number) {
          this.label = label;
          this.collapsibleState = collapsibleState;
        }
      },
      TreeItemCollapsibleState: { None: 0 },
      ThemeIcon: class {
        constructor(public id: string) {}
      },
      Uri: { file: (fsPath: string) => ({ fsPath }) },
      EventEmitter: class {
        event = {};
        fire = vi.fn();
      },
      workspace: {
        getConfiguration: vi.fn(() => ({ get: vi.fn().mockReturnValue('') })),
        onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
        createFileSystemWatcher: vi.fn(() => ({
          onDidCreate: vi.fn(),
          onDidDelete: vi.fn(),
          onDidChange: vi.fn(),
          dispose: vi.fn(),
        })),
      },
      window: {
        showInputBox: vi.fn(),
        showInformationMessage: vi.fn(),
        showErrorMessage: vi.fn(),
        withProgress: vi.fn(),
      },
      ProgressLocation: { Notification: 15 },
      commands: { executeCommand: vi.fn() },
    }));
    const mod = await import('./modelfiles.js');
    ModelfileItem = mod.ModelfileItem;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sets contextValue to "modelfile"', () => {
    const item = new ModelfileItem({ fsPath: '/some/dir/pirate.modelfile' });
    expect(item.contextValue).toBe('modelfile');
  });

  it('uses basename as label', () => {
    const item = new ModelfileItem({ fsPath: '/some/dir/pirate.modelfile' });
    expect(item.label).toBe('pirate.modelfile');
  });

  it('does not set a click command (tree node handles selection)', () => {
    const item = new ModelfileItem({ fsPath: '/some/dir/pirate.modelfile' });
    expect(item.command).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// ModelfilesProvider
// ---------------------------------------------------------------------------

describe('ModelfilesProvider.getChildren', () => {
  it('returns ModelfileItem list from folder', async () => {
    vi.resetModules();

    vi.doMock('node:fs/promises', () => ({
      mkdir: vi.fn().mockResolvedValue(undefined),
      readdir: vi.fn().mockResolvedValue([
        { name: 'pirate.modelfile', isFile: () => true },
        { name: 'assistant.modelfile', isFile: () => true },
        { name: 'README.md', isFile: () => true },
      ]),
      readFile: vi.fn().mockResolvedValue('FROM llama3.2'),
    }));

    vi.doMock('vscode', () => ({
      TreeItem: class {
        label: string;
        collapsibleState: number;
        contextValue?: string;
        iconPath?: unknown;
        tooltip?: string;
        command?: unknown;
        constructor(label: string, collapsibleState: number) {
          this.label = label;
          this.collapsibleState = collapsibleState;
        }
      },
      TreeItemCollapsibleState: { None: 0 },
      ThemeIcon: class {
        constructor(public id: string) {}
      },
      Uri: { file: (fsPath: string) => ({ fsPath }) },
      EventEmitter: class {
        event = {};
        fire = vi.fn();
      },
      RelativePattern: class {
        constructor(
          public base: string,
          public pattern: string,
        ) {}
      },
      workspace: {
        getConfiguration: vi.fn(() => ({ get: vi.fn().mockReturnValue('') })),
        onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
        createFileSystemWatcher: vi.fn(() => ({
          onDidCreate: vi.fn(),
          onDidDelete: vi.fn(),
          onDidChange: vi.fn(),
          dispose: vi.fn(),
        })),
      },
      window: {
        showInputBox: vi.fn(),
        showInformationMessage: vi.fn(),
        showErrorMessage: vi.fn(),
        withProgress: vi.fn(),
      },
      ProgressLocation: { Notification: 15 },
      commands: { executeCommand: vi.fn() },
    }));

    const { ModelfilesProvider } = await import('./modelfiles.js');
    const context = { subscriptions: [] } as any;
    const provider = new ModelfilesProvider(context);
    const children = await provider.getChildren();

    expect(children).toHaveLength(2); // .modelfile files only, not README.md
    expect(children[0].label).toBe('assistant.modelfile');
    expect(children[1].label).toBe('pirate.modelfile');
  });
});

// ---------------------------------------------------------------------------
// handleNewModelfile
// ---------------------------------------------------------------------------

describe('handleNewModelfile', () => {
  let mockClient: any;
  let writtenContent: string;

  beforeEach(async () => {
    vi.resetModules();
    writtenContent = '';

    vi.doMock('node:fs/promises', () => ({
      mkdir: vi.fn().mockResolvedValue(undefined),
      readdir: vi.fn().mockResolvedValue([]),
      readFile: vi.fn().mockResolvedValue(''),
    }));

    vi.doMock('vscode', () => ({
      TreeItem: class {
        constructor(
          public label: string,
          public collapsibleState: number,
        ) {}
      },
      TreeItemCollapsibleState: { None: 0 },
      ThemeIcon: class {
        constructor(public id: string) {}
      },
      RelativePattern: class {
        constructor(
          public base: string,
          public pattern: string,
        ) {}
      },
      Uri: { file: (fsPath: string) => ({ fsPath }) },
      EventEmitter: class {
        event = {};
        fire = vi.fn();
      },
      workspace: {
        getConfiguration: vi.fn(() => ({ get: vi.fn().mockReturnValue('') })),
        onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
        createFileSystemWatcher: vi.fn(() => ({
          onDidCreate: vi.fn(),
          onDidDelete: vi.fn(),
          onDidChange: vi.fn(),
          dispose: vi.fn(),
        })),
        fs: {
          writeFile: vi.fn().mockImplementation((_uri: unknown, data: Buffer) => {
            writtenContent = data.toString('utf8');
          }),
        },
        openTextDocument: vi.fn().mockResolvedValue({ uri: { fsPath: '/tmp/test.modelfile' } }),
      },
      window: {
        showInputBox: vi.fn().mockResolvedValueOnce('pirate-bot').mockResolvedValueOnce('You are a pirate. Arr!'),
        showQuickPick: vi.fn().mockResolvedValue({ label: 'llama3.2:3b', description: 'local' }),
        showTextDocument: vi.fn(),
        showInformationMessage: vi.fn(),
        showErrorMessage: vi.fn(),
        withProgress: vi.fn(),
        registerTreeDataProvider: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      },
      ProgressLocation: { Notification: 15 },
      commands: { registerCommand: vi.fn().mockReturnValue({ dispose: vi.fn() }), executeCommand: vi.fn() },
      languages: {
        registerHoverProvider: vi.fn().mockReturnValue({ dispose: vi.fn() }),
        registerCompletionItemProvider: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      },
      Hover: class {
        constructor(public contents: unknown) {}
      },
      CompletionItem: class {
        constructor(
          public label: string,
          public kind?: number,
        ) {}
      },
      CompletionItemKind: { Keyword: 13, Property: 9 },
      SnippetString: class {
        constructor(public value: string) {}
      },
      MarkdownString: class {
        constructor(public value: string) {}
      },
    }));

    mockClient = {
      list: vi.fn().mockResolvedValue({
        models: [{ name: 'llama3.2:3b' }, { name: 'mistral:latest' }],
      }),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a modelfile using chosen model and system prompt', async () => {
    const { handleNewModelfile } = await import('./modelfiles.js');
    await handleNewModelfile('/modelfiles', mockClient as unknown as import('ollama').Ollama);

    expect(writtenContent).toContain('FROM llama3.2:3b');
    expect(writtenContent).toContain('You are a pirate. Arr!');
  });

  it('shows available local models in the quick pick', async () => {
    const vscode = await import('vscode');
    const { handleNewModelfile } = await import('./modelfiles.js');
    await handleNewModelfile('/modelfiles', mockClient as unknown as import('ollama').Ollama);

    expect(vscode.window.showQuickPick).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ label: 'llama3.2:3b' }),
        expect.objectContaining({ label: 'mistral:latest' }),
      ]),
      expect.objectContaining({ placeHolder: expect.any(String) }),
    );
  });

  it('does nothing when user cancels name input', async () => {
    const vscode = await import('vscode');
    vi.mocked(vscode.window.showInputBox).mockReset().mockResolvedValue(undefined);

    const { handleNewModelfile } = await import('./modelfiles.js');
    await handleNewModelfile('/modelfiles', mockClient as unknown as import('ollama').Ollama);

    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
  });

  it('does nothing when user cancels model selection', async () => {
    const vscode = await import('vscode');
    vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce('pirate-bot');
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined);

    const { handleNewModelfile } = await import('./modelfiles.js');
    await handleNewModelfile('/modelfiles', mockClient as unknown as import('ollama').Ollama);

    expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleBuildModelfile
// ---------------------------------------------------------------------------

describe('handleBuildModelfile', () => {
  let mockClient: any;

  beforeEach(async () => {
    vi.resetModules();

    vi.doMock('node:fs/promises', () => ({
      mkdir: vi.fn().mockResolvedValue(undefined),
      readdir: vi.fn().mockResolvedValue([]),
      readFile: vi.fn().mockResolvedValue('FROM llama3.2\nSYSTEM """test"""'),
    }));

    vi.doMock('vscode', () => ({
      TreeItem: class {
        label: string;
        collapsibleState: number;
        contextValue?: string;
        command?: unknown;
        constructor(label: string, collapsibleState: number) {
          this.label = label;
          this.collapsibleState = collapsibleState;
        }
      },
      TreeItemCollapsibleState: { None: 0 },
      ThemeIcon: class {
        constructor(public id: string) {}
      },
      Uri: { file: (fsPath: string) => ({ fsPath }) },
      EventEmitter: class {
        event = {};
        fire = vi.fn();
      },
      ProgressLocation: { Notification: 15 },
      workspace: {
        getConfiguration: vi.fn(() => ({ get: vi.fn().mockReturnValue('') })),
        onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
        createFileSystemWatcher: vi.fn(() => ({
          onDidCreate: vi.fn(),
          onDidDelete: vi.fn(),
          onDidChange: vi.fn(),
          dispose: vi.fn(),
        })),
      },
      window: {
        showInputBox: vi.fn().mockResolvedValue('my-model'),
        withProgress: vi.fn(async (_opts: unknown, task: (p: { report: (msg: unknown) => void }) => Promise<void>) =>
          task({ report: vi.fn() }),
        ),
        showInformationMessage: vi.fn(),
        showErrorMessage: vi.fn(),
      },
      commands: { executeCommand: vi.fn() },
    }));

    async function* fakeStream() {
      yield { status: 'pulling manifest' };
      yield { status: 'success' };
    }

    mockClient = {
      create: vi.fn().mockReturnValue(fakeStream()),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls client.create with structured fields from parsed Modelfile', async () => {
    const { handleBuildModelfile, ModelfileItem } = await import('./modelfiles.js');
    const item = new ModelfileItem({ fsPath: '/modelfiles/pirate.modelfile' } as unknown as import('vscode').Uri);
    await handleBuildModelfile(item, mockClient as unknown as Ollama);

    expect(mockClient.create).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'my-model', from: 'llama3.2', system: 'test', stream: true }),
    );
  });

  it('does nothing when user cancels the model name input', async () => {
    const vscode = await import('vscode');
    vi.mocked(vscode.window.showInputBox).mockResolvedValue(undefined);

    const { handleBuildModelfile, ModelfileItem } = await import('./modelfiles.js');
    const item = new ModelfileItem({ fsPath: '/modelfiles/pirate.modelfile' } as unknown as import('vscode').Uri);
    await handleBuildModelfile(item, mockClient as unknown as Ollama);

    expect(mockClient.create).not.toHaveBeenCalled();
  });

  it('refreshes local models on success', async () => {
    const vscode = await import('vscode');
    const { handleBuildModelfile, ModelfileItem } = await import('./modelfiles.js');
    const item = new ModelfileItem({ fsPath: '/modelfiles/pirate.modelfile' } as unknown as import('vscode').Uri);
    await handleBuildModelfile(item, mockClient as unknown as Ollama);

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('opilot.refreshLocalModels');
  });

  it('shows error message when client.create throws', async () => {
    mockClient.create = vi.fn().mockImplementation(async function* () {
      yield { status: 'starting' };
      throw new Error('build failed');
    });

    const vscode = await import('vscode');
    const { handleBuildModelfile, ModelfileItem } = await import('./modelfiles.js');
    const item = new ModelfileItem({ fsPath: '/modelfiles/pirate.modelfile' } as unknown as import('vscode').Uri);
    await handleBuildModelfile(item, mockClient as unknown as Ollama);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('build failed'));
  });
});

describe('handleOpenModelfilesFolder', () => {
  beforeEach(() => {
    vi.resetModules();

    vi.doMock('node:fs/promises', () => ({
      mkdir: vi.fn().mockResolvedValue(undefined),
      readdir: vi.fn().mockResolvedValue([]),
      readFile: vi.fn().mockResolvedValue(''),
    }));

    vi.doMock('vscode', () => ({
      TreeItem: class {
        constructor(
          public label: string,
          public collapsibleState: number,
        ) {}
      },
      TreeItemCollapsibleState: { None: 0 },
      ThemeIcon: class {
        constructor(public id: string) {}
      },
      RelativePattern: class {
        constructor(
          public base: string,
          public pattern: string,
        ) {}
      },
      Uri: { file: (fsPath: string) => ({ fsPath }) },
      EventEmitter: class {
        event = {};
        fire = vi.fn();
      },
      workspace: {
        getConfiguration: vi.fn(() => ({ get: vi.fn().mockReturnValue('') })),
        onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
        createFileSystemWatcher: vi.fn(() => ({
          onDidCreate: vi.fn(),
          onDidDelete: vi.fn(),
          onDidChange: vi.fn(),
          dispose: vi.fn(),
        })),
      },
      window: {
        showErrorMessage: vi.fn(),
      },
      env: {
        openExternal: vi.fn().mockResolvedValue(true),
      },
      commands: {
        executeCommand: vi.fn(),
      },
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens the provided modelfiles folder URI in OS', async () => {
    const vscode = await import('vscode');
    const { handleOpenModelfilesFolder } = await import('./modelfiles.js');

    await handleOpenModelfilesFolder('/tmp/modelfiles');

    expect(vscode.env.openExternal).toHaveBeenCalledWith(expect.objectContaining({ fsPath: '/tmp/modelfiles' }));
  });

  it('falls back to revealFileInOS when openExternal returns false', async () => {
    const vscode = await import('vscode');
    vi.mocked(vscode.env.openExternal).mockResolvedValue(false as any);

    const { handleOpenModelfilesFolder } = await import('./modelfiles.js');
    await handleOpenModelfilesFolder('/tmp/modelfiles');

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'revealFileInOS',
      expect.objectContaining({ fsPath: '/tmp/modelfiles' }),
    );
  });
});

// ---------------------------------------------------------------------------
// createHoverProvider
// ---------------------------------------------------------------------------

describe('createHoverProvider', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('vscode', minimalVscodeMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a Hover for a known keyword like FROM', async () => {
    const vscode = await import('vscode');
    const { createHoverProvider } = await import('./modelfiles.js');
    const provider = createHoverProvider();

    const range = {};
    const document = {
      getWordRangeAtPosition: vi.fn().mockReturnValue(range),
      getText: vi.fn().mockReturnValue('FROM'),
    };

    const result = provider.provideHover(document as any, {} as any, null as any);
    expect(result).toBeInstanceOf(vscode.Hover);
  });

  it('returns a Hover for a known parameter like temperature', async () => {
    const vscode = await import('vscode');
    const { createHoverProvider } = await import('./modelfiles.js');
    const provider = createHoverProvider();

    const range = {};
    const document = {
      getWordRangeAtPosition: vi.fn().mockReturnValue(range),
      getText: vi.fn().mockReturnValue('temperature'),
    };

    const result = provider.provideHover(document as any, {} as any, null as any);
    expect(result).toBeInstanceOf(vscode.Hover);
  });

  it('returns null for an unknown word', async () => {
    const { createHoverProvider } = await import('./modelfiles.js');
    const provider = createHoverProvider();

    const range = {};
    const document = {
      getWordRangeAtPosition: vi.fn().mockReturnValue(range),
      getText: vi.fn().mockReturnValue('UNKNOWN_WORD_XYZ'),
    };

    const result = provider.provideHover(document as any, {} as any, null as any);
    expect(result).toBeNull();
  });

  it('returns null when no word range at cursor position', async () => {
    const { createHoverProvider } = await import('./modelfiles.js');
    const provider = createHoverProvider();

    const document = {
      getWordRangeAtPosition: vi.fn().mockReturnValue(null),
      getText: vi.fn(),
    };

    const result = provider.provideHover(document as any, {} as any, null as any);
    expect(result).toBeNull();
    expect(document.getText).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// createCompletionProvider
// ---------------------------------------------------------------------------

describe('createCompletionProvider', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('vscode', minimalVscodeMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns keyword completions when at line start', async () => {
    const vscode = await import('vscode');
    const { createCompletionProvider } = await import('./modelfiles.js');
    const provider = createCompletionProvider();

    const position = { character: 4 };
    const document = { lineAt: vi.fn().mockReturnValue({ text: 'FROM' }) };

    const items = provider.provideCompletionItems(document as any, position as any, null as any, null as any) as any[];
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((i: any) => i.label === 'FROM')).toBe(true);
    expect(items[0]).toBeInstanceOf(vscode.CompletionItem);
  });

  it('returns parameter completions on a PARAMETER line', async () => {
    const vscode = await import('vscode');
    const { createCompletionProvider } = await import('./modelfiles.js');
    const provider = createCompletionProvider();

    // lineText = 'PARAMETER '.substring(0,10) = 'PARAMETER '
    const position = { character: 10 };
    const document = { lineAt: vi.fn().mockReturnValue({ text: 'PARAMETER temperature' }) };

    const items = provider.provideCompletionItems(document as any, position as any, null as any, null as any) as any[];
    expect(items.some((i: any) => i.label === 'temperature')).toBe(true);
    expect(items[0]).toBeInstanceOf(vscode.CompletionItem);
  });

  it('returns empty array when not at a keyword or parameter position', async () => {
    const { createCompletionProvider } = await import('./modelfiles.js');
    const provider = createCompletionProvider();

    const position = { character: 11 };
    const document = { lineAt: vi.fn().mockReturnValue({ text: 'hello world 123' }) };

    const items = provider.provideCompletionItems(document as any, position as any, null as any, null as any);
    expect(items).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// registerModelfileManager
// ---------------------------------------------------------------------------

describe('registerModelfileManager', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('vscode', minimalVscodeMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers tree provider, commands, and language providers', async () => {
    const vscode = await import('vscode');
    const { registerModelfileManager } = await import('./modelfiles.js');

    const subscriptions: any[] = [];
    const context = { subscriptions } as any;
    const client = {} as any;

    registerModelfileManager(context, client);

    expect(vscode.window.registerTreeDataProvider).toHaveBeenCalledWith('ollama-modelfiles', expect.any(Object));
    expect(vscode.commands.registerCommand).toHaveBeenCalledWith('opilot.refreshModelfiles', expect.any(Function));
    expect(vscode.commands.registerCommand).toHaveBeenCalledWith('opilot.newModelfile', expect.any(Function));
    expect(vscode.commands.registerCommand).toHaveBeenCalledWith('opilot.editModelfile', expect.any(Function));
    expect(vscode.commands.registerCommand).toHaveBeenCalledWith('opilot.buildModelfile', expect.any(Function));
    expect(vscode.commands.registerCommand).toHaveBeenCalledWith('opilot.openModelfilesFolder', expect.any(Function));
    expect(vscode.languages.registerHoverProvider).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'modelfile' }),
      expect.any(Object),
    );
    expect(vscode.languages.registerCompletionItemProvider).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'modelfile' }),
      expect.any(Object),
      ' ',
    );
  });

  it('invokes all registered command callbacks covering inner lambdas', async () => {
    vi.resetModules();

    const cbMap = new Map<string, Function>();
    const registerCommand = vi.fn((name: string, cb: Function) => {
      cbMap.set(name, cb);
      return { dispose: vi.fn() };
    });

    vi.doMock('vscode', () => ({
      ...minimalVscodeMock(),
      commands: { registerCommand, executeCommand: vi.fn() },
    }));

    const { registerModelfileManager } = await import('./modelfiles.js');

    const subscriptions: any[] = [];
    const context = {
      subscriptions,
      extensionUri: { fsPath: '/fake/ext' },
    } as any;
    const client = {} as any;

    registerModelfileManager(context, client);

    const getCb = (name: string) => cbMap.get(name);

    // refreshModelfiles: () => provider.refresh()
    getCb('opilot.refreshModelfiles')?.();

    // newModelfile: () => handleNewModelfile(path, client) — showInputBox returns undefined → early return
    await getCb('opilot.newModelfile')?.();

    // editModelfile: (item) => executeCommand('vscode.open', item.uri) — pass fake item
    getCb('opilot.editModelfile')?.({ uri: { fsPath: '/fake/test.modelfile' } });

    // buildModelfile: (item) => handleBuildModelfile(item, client) — showInputBox returns undefined → early return
    await getCb('opilot.buildModelfile')?.({ label: 'test', uri: { fsPath: '/fake/test.modelfile' } });

    // openModelfilesFolder: async () => handleOpenModelfilesFolder(path) — env.openExternal is mocked
    await getCb('opilot.openModelfilesFolder')?.();

    expect(cbMap.size).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// parseModelfile
// ---------------------------------------------------------------------------

describe('parseModelfile', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('vscode', minimalVscodeMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses basic FROM directive', async () => {
    const { parseModelfile } = await import('./modelfiles.js');
    expect(parseModelfile('FROM llama3.2')).toMatchObject({ from: 'llama3.2' });
  });

  it('parses SYSTEM directive', async () => {
    const { parseModelfile } = await import('./modelfiles.js');
    const result = parseModelfile('FROM base\nSYSTEM You are helpful.');
    expect(result.system).toBe('You are helpful.');
  });

  it('parses TEMPLATE directive', async () => {
    const { parseModelfile } = await import('./modelfiles.js');
    const result = parseModelfile('FROM base\nTEMPLATE {{ .Prompt }}');
    expect(result.template).toBe('{{ .Prompt }}');
  });

  it('parses single LICENSE as string', async () => {
    const { parseModelfile } = await import('./modelfiles.js');
    const result = parseModelfile('FROM base\nLICENSE MIT');
    expect(result.license).toBe('MIT');
  });

  it('parses multiple LICENSEs as array', async () => {
    const { parseModelfile } = await import('./modelfiles.js');
    const result = parseModelfile('FROM base\nLICENSE MIT\nLICENSE Apache-2.0');
    expect(result.license).toEqual(['MIT', 'Apache-2.0']);
  });

  it('parses ADAPTER directive', async () => {
    const { parseModelfile } = await import('./modelfiles.js');
    const result = parseModelfile('FROM base\nADAPTER ./my-adapter.gguf');
    expect(result.adapters).toEqual({ './my-adapter.gguf': './my-adapter.gguf' });
  });

  it('parses PARAMETER with numeric value', async () => {
    const { parseModelfile } = await import('./modelfiles.js');
    const result = parseModelfile('FROM base\nPARAMETER temperature 0.7');
    expect(result.parameters).toEqual({ temperature: 0.7 });
  });

  it('parses PARAMETER with integer value', async () => {
    const { parseModelfile } = await import('./modelfiles.js');
    const result = parseModelfile('FROM base\nPARAMETER num_ctx 4096');
    expect(result.parameters).toEqual({ num_ctx: 4096 });
  });

  it('parses PARAMETER with string value', async () => {
    const { parseModelfile } = await import('./modelfiles.js');
    const result = parseModelfile('FROM base\nPARAMETER stop "<end>"');
    expect(result.parameters?.stop).toBe('"<end>"');
  });

  it('parses multiple PARAMETERs', async () => {
    const { parseModelfile } = await import('./modelfiles.js');
    const result = parseModelfile('FROM base\nPARAMETER temperature 0.5\nPARAMETER num_ctx 2048');
    expect(result.parameters).toEqual({ temperature: 0.5, num_ctx: 2048 });
  });

  it('parses MESSAGE with role and quoted content', async () => {
    const { parseModelfile } = await import('./modelfiles.js');
    const result = parseModelfile('FROM base\nMESSAGE user "hello there"');
    expect(result.messages).toEqual([{ role: 'user', content: 'hello there' }]);
  });

  it('parses MESSAGE with role and unquoted content', async () => {
    const { parseModelfile } = await import('./modelfiles.js');
    const result = parseModelfile('FROM base\nMESSAGE assistant You are welcome.');
    expect(result.messages).toEqual([{ role: 'assistant', content: 'You are welcome.' }]);
  });

  it('parses MESSAGE with system role', async () => {
    const { parseModelfile } = await import('./modelfiles.js');
    const result = parseModelfile('FROM base\nMESSAGE system Be helpful.');
    expect(result.messages).toEqual([{ role: 'system', content: 'Be helpful.' }]);
  });

  it('parses triple-quoted single-line SYSTEM', async () => {
    const { parseModelfile } = await import('./modelfiles.js');
    const result = parseModelfile('FROM base\nSYSTEM """hello world"""');
    expect(result.system).toBe('hello world');
  });

  it('parses triple-quoted multi-line SYSTEM', async () => {
    const { parseModelfile } = await import('./modelfiles.js');
    const content = 'FROM base\nSYSTEM """\nline one\nline two\n"""';
    const result = parseModelfile(content);
    expect(result.system).toContain('line one');
    expect(result.system).toContain('line two');
  });

  it('parses triple-quoted multi-line where closing line has trailing content', async () => {
    const { parseModelfile } = await import('./modelfiles.js');
    const content = 'FROM base\nSYSTEM """\ntrailing line"""';
    const result = parseModelfile(content);
    expect(result.system).toContain('trailing line');
  });

  it('parses regular double-quoted SYSTEM value', async () => {
    const { parseModelfile } = await import('./modelfiles.js');
    const result = parseModelfile('FROM base\nSYSTEM "simple quoted"');
    expect(result.system).toBe('simple quoted');
  });

  it('skips comment lines', async () => {
    const { parseModelfile } = await import('./modelfiles.js');
    const result = parseModelfile('# This is a comment\nFROM base');
    expect(result.from).toBe('base');
  });

  it('skips blank lines', async () => {
    const { parseModelfile } = await import('./modelfiles.js');
    const result = parseModelfile('\n\nFROM base\n\n');
    expect(result.from).toBe('base');
  });

  it('skips unknown keywords', async () => {
    const { parseModelfile } = await import('./modelfiles.js');
    const result = parseModelfile('FROM base\nUNKNOWN value');
    expect(result.from).toBe('base');
    expect(result.system).toBeUndefined();
  });

  it('skips lines with no space separator (bare keyword)', async () => {
    const { parseModelfile } = await import('./modelfiles.js');
    const result = parseModelfile('FROM base\nNOSPACE');
    expect(result.from).toBe('base');
    expect(result.system).toBeUndefined();
  });

  it('does not include parameters key when no PARAMETER directives', async () => {
    const { parseModelfile } = await import('./modelfiles.js');
    const result = parseModelfile('FROM base');
    expect(result.parameters).toBeUndefined();
  });

  it('does not include messages key when no MESSAGE directives', async () => {
    const { parseModelfile } = await import('./modelfiles.js');
    const result = parseModelfile('FROM base');
    expect(result.messages).toBeUndefined();
  });

  it('handles mixed directives in one Modelfile', async () => {
    const { parseModelfile } = await import('./modelfiles.js');
    const content = [
      'FROM llama3.2',
      'SYSTEM "Be helpful"',
      'PARAMETER temperature 0.5',
      'PARAMETER num_ctx 4096',
      'MESSAGE user hello',
      'MESSAGE assistant Hi!',
    ].join('\n');
    const result = parseModelfile(content);
    expect(result.from).toBe('llama3.2');
    expect(result.system).toBe('Be helpful');
    expect(result.parameters).toEqual({ temperature: 0.5, num_ctx: 4096 });
    expect(result.messages).toHaveLength(2);
  });

  it('returns empty object when content is empty', async () => {
    const { parseModelfile } = await import('./modelfiles.js');
    const result = parseModelfile('');
    expect(result).toEqual({});
  });

  it('ignores invalid MESSAGE lines (no space in value)', async () => {
    const { parseModelfile } = await import('./modelfiles.js');
    const result = parseModelfile('FROM base\nMESSAGE invalidsingletoken');
    expect(result.messages).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// ModelfilesProvider.getChildren — error path
// ---------------------------------------------------------------------------

describe('ModelfilesProvider.getChildren error path', () => {
  it('returns empty array when readdir throws', async () => {
    vi.resetModules();

    vi.doMock('node:fs/promises', () => ({
      mkdir: vi.fn().mockResolvedValue(undefined),
      readdir: vi.fn().mockRejectedValue(new Error('ENOENT: no such file or directory')),
      readFile: vi.fn().mockResolvedValue(''),
    }));

    vi.doMock('vscode', () => ({
      ...minimalVscodeMock(),
    }));

    const { ModelfilesProvider } = await import('./modelfiles.js');
    const context = { subscriptions: [] } as any;
    const provider = new ModelfilesProvider(context);
    const children = await provider.getChildren();
    expect(children).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ModelfilesProvider watcher callbacks cover refresh()
// ---------------------------------------------------------------------------

describe('ModelfilesProvider watcher callbacks', () => {
  it('calls refresh when watcher fires onDidCreate', async () => {
    vi.resetModules();

    let onDidCreateCb: (() => void) | undefined;

    vi.doMock('node:fs/promises', () => ({
      mkdir: vi.fn().mockResolvedValue(undefined),
      readdir: vi.fn().mockResolvedValue([]),
    }));

    const watcherMock = {
      onDidCreate: vi.fn((cb: () => void) => {
        onDidCreateCb = cb;
        return { dispose: vi.fn() };
      }),
      onDidDelete: vi.fn(() => ({ dispose: vi.fn() })),
      onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
      dispose: vi.fn(),
    };

    vi.doMock('vscode', () => ({
      ...minimalVscodeMock(),
      workspace: {
        ...minimalVscodeMock().workspace,
        createFileSystemWatcher: vi.fn(() => watcherMock),
      },
    }));

    const { ModelfilesProvider } = await import('./modelfiles.js');
    const context = { subscriptions: [] } as any;
    const provider = new ModelfilesProvider(context);

    const fireCall = vi.fn();
    (provider as any).treeChangeEmitter.fire = fireCall;

    onDidCreateCb?.();

    expect(fireCall).toHaveBeenCalledWith(null);
  });

  it('calls refresh when watcher fires onDidDelete', async () => {
    vi.resetModules();

    let onDidDeleteCb: (() => void) | undefined;

    vi.doMock('node:fs/promises', () => ({
      mkdir: vi.fn().mockResolvedValue(undefined),
      readdir: vi.fn().mockResolvedValue([]),
    }));

    const watcherMock = {
      onDidCreate: vi.fn(() => ({ dispose: vi.fn() })),
      onDidDelete: vi.fn((cb: () => void) => {
        onDidDeleteCb = cb;
        return { dispose: vi.fn() };
      }),
      onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
      dispose: vi.fn(),
    };

    vi.doMock('vscode', () => ({
      ...minimalVscodeMock(),
      workspace: {
        ...minimalVscodeMock().workspace,
        createFileSystemWatcher: vi.fn(() => watcherMock),
      },
    }));

    const { ModelfilesProvider } = await import('./modelfiles.js');
    const context = { subscriptions: [] } as any;
    const provider = new ModelfilesProvider(context);

    const fireCall = vi.fn();
    (provider as any).treeChangeEmitter.fire = fireCall;

    onDidDeleteCb?.();

    expect(fireCall).toHaveBeenCalledWith(null);
  });

  it('updates folderPath when modelfilesPath configuration changes', async () => {
    vi.resetModules();

    let configChangeCb: ((e: any) => void) | undefined;

    vi.doMock('node:fs/promises', () => ({
      mkdir: vi.fn().mockResolvedValue(undefined),
      readdir: vi.fn().mockResolvedValue([]),
    }));

    vi.doMock('vscode', () => ({
      ...minimalVscodeMock(),
      workspace: {
        ...minimalVscodeMock().workspace,
        onDidChangeConfiguration: vi.fn((cb: (e: any) => void) => {
          configChangeCb = cb;
          return { dispose: vi.fn() };
        }),
        getConfiguration: vi.fn(() => ({
          get: vi.fn().mockReturnValue('/new/path'),
        })),
      },
    }));

    const { ModelfilesProvider } = await import('./modelfiles.js');
    const context = { subscriptions: [] } as any;
    const provider = new ModelfilesProvider(context);
    const fireCall = vi.fn();
    (provider as any).treeChangeEmitter.fire = fireCall;

    configChangeCb?.({ affectsConfiguration: (key: string) => key === 'ollama.modelfilesPath' });

    expect(fireCall).toHaveBeenCalledWith(null);
  });
});

// ---------------------------------------------------------------------------
// handleNewModelfile — additional edge cases
// ---------------------------------------------------------------------------

describe('handleNewModelfile edge cases', () => {
  beforeEach(() => {
    vi.resetModules();

    vi.doMock('node:fs/promises', () => ({
      mkdir: vi.fn().mockResolvedValue(undefined),
      readdir: vi.fn().mockResolvedValue([]),
      readFile: vi.fn().mockResolvedValue(''),
    }));

    vi.doMock('vscode', () => ({
      ...minimalVscodeMock(),
      workspace: {
        ...minimalVscodeMock().workspace,
        fs: { writeFile: vi.fn().mockResolvedValue(undefined) },
        openTextDocument: vi.fn().mockResolvedValue({}),
      },
      window: {
        ...minimalVscodeMock().window,
        showInputBox: vi.fn(),
        showQuickPick: vi.fn(),
        showTextDocument: vi.fn(),
      },
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('falls back to default model when client.list() throws', async () => {
    const vscode = await import('vscode');
    vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce('my-bot').mockResolvedValueOnce('You are helpful.');
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue({ label: 'llama3.2:3b', description: 'default' });
    vi.mocked(vscode.window.showTextDocument).mockResolvedValue(undefined as any);

    const mockClient = { list: vi.fn().mockRejectedValue(new Error('connection refused')) } as any;
    const { handleNewModelfile } = await import('./modelfiles.js');
    await handleNewModelfile('/modelfiles', mockClient);

    // Quick pick should still be shown with a fallback model
    expect(vscode.window.showQuickPick).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ label: 'llama3.2:3b' })]),
      expect.anything(),
    );
  });

  it('cancels when systemPrompt input is dismissed with undefined', async () => {
    const vscode = await import('vscode');
    vi.mocked(vscode.window.showInputBox)
      .mockResolvedValueOnce('my-bot') // name
      .mockResolvedValueOnce(undefined); // systemPrompt cancelled
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue({ label: 'llama3.2:3b', description: 'local' });

    const mockClient = { list: vi.fn().mockResolvedValue({ models: [{ name: 'llama3.2:3b' }] }) } as any;
    const { handleNewModelfile } = await import('./modelfiles.js');
    await handleNewModelfile('/modelfiles', mockClient);

    expect(vscode.workspace.fs.writeFile).not.toHaveBeenCalled();
  });

  it('validateInput for name rejects empty string', async () => {
    let capturedValidator: ((v: string) => string | null) | undefined;
    const vscode = await import('vscode');
    vi.mocked(vscode.window.showInputBox).mockImplementation(async (opts: any) => {
      if (opts?.validateInput) capturedValidator = opts.validateInput;
      return undefined;
    });

    const mockClient = { list: vi.fn().mockResolvedValue({ models: [] }) } as any;
    const { handleNewModelfile } = await import('./modelfiles.js');
    await handleNewModelfile('/modelfiles', mockClient);

    expect(capturedValidator?.('')).toBe('Name is required');
    expect(capturedValidator?.('valid-name')).toBeNull();
    expect(capturedValidator?.('has/slash')).toContain('path separators');
  });
});

// ---------------------------------------------------------------------------
// handleBuildModelfile — missing FROM
// ---------------------------------------------------------------------------

describe('handleBuildModelfile missing FROM', () => {
  it('shows error when Modelfile has no FROM directive', async () => {
    vi.resetModules();

    vi.doMock('node:fs/promises', () => ({
      mkdir: vi.fn().mockResolvedValue(undefined),
      readdir: vi.fn().mockResolvedValue([]),
      readFile: vi.fn().mockResolvedValue('SYSTEM "I have no base model"'),
    }));

    vi.doMock('vscode', () => ({
      ...minimalVscodeMock(),
      window: {
        ...minimalVscodeMock().window,
        showInputBox: vi.fn().mockResolvedValue('my-model'),
        withProgress: vi.fn(async (_opts: unknown, task: (p: any) => Promise<void>) => task({ report: vi.fn() })),
      },
    }));

    const vscode = await import('vscode');
    const mockClient = { create: vi.fn() } as any;
    const { handleBuildModelfile, ModelfileItem } = await import('./modelfiles.js');
    const item = new ModelfileItem({ fsPath: '/modelfiles/bad.modelfile' } as any);
    await handleBuildModelfile(item, mockClient);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('missing the required FROM'));
    expect(mockClient.create).not.toHaveBeenCalled();
  });

  it('validateInput for model name rejects empty string', async () => {
    vi.resetModules();

    let capturedValidator: ((v: string) => string | null) | undefined;

    vi.doMock('node:fs/promises', () => ({
      mkdir: vi.fn().mockResolvedValue(undefined),
      readdir: vi.fn().mockResolvedValue([]),
      readFile: vi.fn().mockResolvedValue('FROM base'),
    }));

    vi.doMock('vscode', () => ({
      ...minimalVscodeMock(),
      window: {
        ...minimalVscodeMock().window,
        showInputBox: vi.fn().mockImplementation(async (opts: any) => {
          if (opts?.validateInput) capturedValidator = opts.validateInput;
          return undefined;
        }),
        withProgress: vi.fn(),
      },
    }));

    const mockClient = { create: vi.fn() } as any;
    const { handleBuildModelfile, ModelfileItem } = await import('./modelfiles.js');
    const item = new ModelfileItem({ fsPath: '/modelfiles/test.modelfile' } as any);
    await handleBuildModelfile(item, mockClient);

    expect(capturedValidator?.('')).toBe('Model name is required');
    expect(capturedValidator?.('valid-model')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// handleOpenModelfilesFolder — error path
// ---------------------------------------------------------------------------

describe('handleOpenModelfilesFolder error path', () => {
  it('reports error when openExternal throws', async () => {
    vi.resetModules();

    vi.doMock('node:fs/promises', () => ({
      mkdir: vi.fn().mockResolvedValue(undefined),
      readdir: vi.fn().mockResolvedValue([]),
    }));

    vi.doMock('vscode', () => ({
      ...minimalVscodeMock(),
      env: { openExternal: vi.fn().mockRejectedValue(new Error('cannot open')) },
      Uri: { file: vi.fn((p: string) => ({ fsPath: p })) },
      window: {
        ...minimalVscodeMock().window,
        showErrorMessage: vi.fn(),
      },
    }));

    const vscode = await import('vscode');
    const { handleOpenModelfilesFolder } = await import('./modelfiles.js');
    await handleOpenModelfilesFolder('/modelfiles');

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('Failed to open Modelfiles folder'),
    );
  });
});

// ---------------------------------------------------------------------------
// parseMultiLineTripleQuoted
// ---------------------------------------------------------------------------

describe('parseMultiLineTripleQuoted', () => {
  let parseMultiLineTripleQuoted: (
    lines: string[],
    startIdx: number,
    afterOpen: string,
  ) => { value: string; endIdx: number };

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('vscode', () => minimalVscodeMock());
    vi.doMock('ollama', () => ({ Ollama: class MockOllama {} }));
    ({ parseMultiLineTripleQuoted } = await import('./modelfiles.js'));
  });

  afterEach(() => vi.restoreAllMocks());

  it('should export parseMultiLineTripleQuoted', () => {
    expect(typeof parseMultiLineTripleQuoted).toBe('function');
  });

  it('captures content spanning multiple lines until closing triple-quotes', () => {
    const lines = ['SYSTEM """', 'line one', 'line two', '"""'];
    const result = parseMultiLineTripleQuoted(lines, 0, '');
    expect(result.value).toContain('line one');
    expect(result.value).toContain('line two');
    expect(result.endIdx).toBe(3);
  });

  it('handles closing triple-quotes on the same line as the last content', () => {
    const lines = ['SYSTEM """', 'hello"""'];
    const result = parseMultiLineTripleQuoted(lines, 0, '');
    expect(result.value).toContain('hello');
    expect(result.endIdx).toBe(1);
  });

  it('returns everything consumed if closing triple-quotes are never found', () => {
    const lines = ['SYSTEM """', 'no closing quote', 'still open'];
    const result = parseMultiLineTripleQuoted(lines, 0, '');
    expect(result.value).toContain('no closing quote');
    expect(result.endIdx).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// resolveLineValue
// ---------------------------------------------------------------------------

describe('resolveLineValue', () => {
  let resolveLineValue: (value: string, lines: string[], lineIdx: number) => { value: string; newIdx: number };

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('vscode', () => minimalVscodeMock());
    vi.doMock('ollama', () => ({ Ollama: class MockOllama {} }));
    ({ resolveLineValue } = await import('./modelfiles.js'));
  });

  afterEach(() => vi.restoreAllMocks());

  it('should export resolveLineValue', () => {
    expect(typeof resolveLineValue).toBe('function');
  });

  it('strips surrounding double-quotes from a single-line quoted value', () => {
    const result = resolveLineValue('"hello world"', [], 0);
    expect(result.value).toBe('hello world');
    expect(result.newIdx).toBe(0);
  });

  it('returns the raw value when not quoted', () => {
    const result = resolveLineValue('rawvalue', [], 0);
    expect(result.value).toBe('rawvalue');
  });

  it('handles inline triple-quoted value that opens and closes on the same token', () => {
    const result = resolveLineValue('"""hello"""', [], 0);
    expect(result.value).toBe('hello');
  });

  it('handles multi-line triple-quoted value spanning subsequent lines', () => {
    const lines = ['SYSTEM """', 'line a', '"""'];
    const result = resolveLineValue('"""', lines, 0);
    expect(result.value).toContain('line a');
    expect(result.newIdx).toBeGreaterThan(0);
  });
});
