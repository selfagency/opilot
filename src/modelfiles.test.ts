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

  it('opens the file on click via command', () => {
    const item = new ModelfileItem({ fsPath: '/some/dir/pirate.modelfile' });
    expect(item.command?.command).toBe('vscode.open');
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

  it('calls client.create with model name and modelfile content', async () => {
    const { handleBuildModelfile, ModelfileItem } = await import('./modelfiles.js');
    const item = new ModelfileItem({ fsPath: '/modelfiles/pirate.modelfile' } as unknown as import('vscode').Uri);
    await handleBuildModelfile(item, mockClient as unknown as Ollama);

    expect(mockClient.create).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'my-model', modelfile: 'FROM llama3.2\nSYSTEM """test"""' }),
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

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('ollama-copilot.refreshLocalModels');
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
});
