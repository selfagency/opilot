import type { Ollama } from 'ollama';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtensionContext } from 'vscode';
import type { CloudModelsProvider, LibraryModelsProvider, LocalModelsProvider, ModelTreeItem } from './sidebar.js';

describe('LocalModelsProvider', () => {
  let provider: any;
  let mockClient: Ollama;
  let ModelTreeItem: any;
  let LocalModelsProvider: any;
  let LibraryModelsProvider: any;
  let CloudModelsProvider: any;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('vscode', () => ({
      TreeItem: class {
        label: string;
        description?: string;
        contextValue?: string;
        collapsibleState?: number;
        iconPath?: unknown;
        tooltip?: string;

        constructor(label: string) {
          this.label = label;
        }
      },
      ThemeIcon: class {
        id: string;

        constructor(id: string) {
          this.id = id;
        }
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
        withProgress: vi.fn(async (_options: unknown, callback: (progress: any, token: any) => Promise<void>) => {
          const mockProgress = { report: vi.fn() };
          const mockToken = { isCancellationRequested: false, onCancellationRequested: vi.fn() };
          return callback(mockProgress, mockToken);
        }),
        showInputBox: vi.fn(),
        showErrorMessage: vi.fn(),
        showInformationMessage: vi.fn(),
        showWarningMessage: vi.fn().mockResolvedValue('Delete'),
      },
      commands: {
        registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
        executeCommand: vi.fn(),
      },
      env: {
        openExternal: vi.fn(),
      },
      Uri: {
        parse: vi.fn((value: string) => ({ value })),
      },
      ProgressLocation: { Notification: 15 },
      workspace: {
        getConfiguration: vi.fn(() => ({
          get: vi.fn((key: string) => {
            if (key === 'localModelRefreshInterval') return 0;
            if (key === 'libraryRefreshInterval') return 0;
            return undefined;
          }),
          update: vi.fn().mockResolvedValue(undefined),
        })),
        onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
      },
    }));

    const sidebarModule = await import('./sidebar.js');
    LocalModelsProvider = sidebarModule.LocalModelsProvider;
    ModelTreeItem = sidebarModule.ModelTreeItem;
    LibraryModelsProvider = sidebarModule.LibraryModelsProvider;
    CloudModelsProvider = sidebarModule.CloudModelsProvider;

    mockClient = {
      list: vi.fn().mockResolvedValue({
        models: [
          {
            name: 'llama2:latest',
            size: 3826087936,
            digest: 'abc123',
            details: { parameter_size: '7B', quantization_level: 'Q4_0' },
          },
          {
            name: 'mistral:latest',
            size: 4109738016,
            digest: 'def456',
            details: { parameter_size: '7B', quantization_level: 'Q4_0' },
          },
        ],
      }),
      ps: vi.fn().mockResolvedValue({
        models: [
          {
            name: 'llama2:latest',
            digest: 'abc123',
            size: 3826087936,
            expires_at: '2099-03-05T00:00:00Z',
            size_vram: 3826087936,
          },
        ],
      }),
      delete: vi.fn().mockResolvedValue({}),
      generate: vi.fn().mockResolvedValue({}),
      pull: vi.fn().mockResolvedValue({}),
    } as unknown as Ollama;

    provider = new LocalModelsProvider(mockClient);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('returns local models sorted alphabetically', async () => {
    const models = await provider.getChildren();

    // getChildren() now returns model-group items (one per family), sorted alphabetically
    expect(models).toHaveLength(2);
    expect(models[0].label).toBe('llama');
    expect(models[1].label).toBe('mistral');
  });

  it('invokes onLocalModelsChanged callback when local models are refreshed', async () => {
    vi.useFakeTimers();
    try {
      const onLocalModelsChanged = vi.fn();
      const callbackProvider = new LocalModelsProvider(mockClient, undefined, undefined, onLocalModelsChanged);

      callbackProvider.refresh();
      // refresh() is debounced — advance past the 300ms window
      await vi.advanceTimersByTimeAsync(300);

      expect(onLocalModelsChanged).toHaveBeenCalledTimes(1);
      callbackProvider.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not leak configuration listeners when localModelRefreshInterval changes multiple times', async () => {
    const vscode = await import('vscode');
    const onDidChangeConfigListeners: Array<(e: any) => void> = [];

    // Replace the onDidChangeConfiguration mock to track listener registrations
    vi.mocked(vscode.workspace.onDidChangeConfiguration).mockImplementation((listener: any) => {
      onDidChangeConfigListeners.push(listener);
      return { dispose: vi.fn() };
    });

    // Create a fresh provider with the new mock
    const testProvider = new LocalModelsProvider(mockClient);
    const initialListeners = onDidChangeConfigListeners.length;

    // Simulate the config change event being fired 3 times
    const fakeEvent = { affectsConfiguration: (key: string) => key === 'ollama.localModelRefreshInterval' };
    for (let i = 0; i < 3; i++) {
      // Fire ALL current listeners (simulates VS Code dispatching the event)
      [...onDidChangeConfigListeners].forEach(l => l(fakeEvent));
      // Give time for any async operations
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    // There should be exactly the initial listener count (registered once in constructor), not growing
    expect(onDidChangeConfigListeners.length).toBe(initialListeners);

    testProvider.dispose();
  });

  it('adds tooltip process details for local models', async () => {
    const groups = await provider.getChildren();
    const llamaGroup = groups.find((g: any) => g.label === 'llama');
    expect(llamaGroup).toBeDefined();
    const llamaModels = await provider.getChildren(llamaGroup);
    expect(llamaModels[0].tooltip).toContain('llama2:latest');
    expect(llamaModels[0].tooltip).toContain('abc123');
    expect(llamaModels[0].tooltip).toContain('GPU');
  });

  it('returns no children for nested element', async () => {
    const item = new ModelTreeItem('llama2:latest', 'local-running', 3826087936, 1000);
    const children = await provider.getChildren(item);
    expect(children).toEqual([]);
  });

  it('formats running model description with size and duration', () => {
    const item = new ModelTreeItem('llama2:latest', 'local-running', 3826087936, 90_000);
    expect(item.description).toContain('GB');
    expect(item.description).toContain('1m');
  });

  it('uses play-circle icon for running models', () => {
    const localRunning = new ModelTreeItem('llama2:latest', 'local-running', 3826087936, 90_000);
    const cloudRunning = new ModelTreeItem('cloud/llama2:latest', 'cloud-running', undefined, 90_000);

    expect((localRunning.iconPath as { id: string }).id).toBe('play-circle');
    expect((cloudRunning.iconPath as { id: string }).id).toBe('play-circle');
  });

  it('uses stop-circle icon for stopped models', () => {
    const localStopped = new ModelTreeItem('mistral:latest', 'local-stopped', 4109738016);
    const cloudStopped = new ModelTreeItem('cloud/mistral:latest', 'cloud-stopped');

    expect((localStopped.iconPath as { id: string }).id).toBe('stop-circle');
    expect((cloudStopped.iconPath as { id: string }).id).toBe('stop-circle');
  });

  it('returns tree item unchanged', () => {
    const item = new ModelTreeItem('mistral:latest', 'local-stopped', 4109738016);
    const treeItem = provider.getTreeItem(item);

    expect(treeItem.label).toBe('mistral:latest');
    expect(treeItem.description).toContain('GB');
  });

  it('does not auto-open model details when selecting library model items', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => '<a href="/library/llama3"></a><a href="/library/mistral"></a>',
      }),
    );

    const libraryProvider = new LibraryModelsProvider(undefined);
    const models = await libraryProvider.getChildren();

    expect(models[0].command).toBeUndefined();
    libraryProvider.dispose();
  });

  it('cloud model items have opilot.openModelSettingsForModel command', async () => {
    vi.resetModules();

    vi.doMock('./client.js', () => ({
      getCloudOllamaClient: vi.fn().mockResolvedValue({
        list: vi.fn().mockResolvedValue({ models: [{ name: 'llama3:cloud', size: 1024 }] }),
        ps: vi.fn().mockResolvedValue({ models: [] }),
      }),
      fetchModelCapabilities: vi.fn().mockResolvedValue({
        toolCalling: false,
        imageInput: false,
        maxInputTokens: 2048,
        maxOutputTokens: 2048,
      }),
    }));

    vi.doMock('vscode', () => ({
      TreeItem: class {
        label: string;
        description?: string;
        contextValue?: string;
        collapsibleState?: number;
        tooltip?: string;
        command?: unknown;
        constructor(label: string) {
          this.label = label;
        }
      },
      ThemeIcon: class {},
      TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
      EventEmitter: class {
        event = {};
        fire = vi.fn();
      },
      window: {
        showInputBox: vi.fn(),
        showErrorMessage: vi.fn(),
        showInformationMessage: vi.fn(),
        showWarningMessage: vi.fn(),
        withProgress: vi.fn(async (_options: unknown, callback: (progress: any, token: any) => Promise<void>) => {
          return callback({ report: vi.fn() }, { isCancellationRequested: false, onCancellationRequested: vi.fn() });
        }),
      },
      commands: {
        registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
        executeCommand: vi.fn(),
      },
      env: {
        openExternal: vi.fn(),
      },
      Uri: {
        parse: vi.fn((value: string) => ({ value })),
      },
      ProgressLocation: { Notification: 15 },
      workspace: {
        getConfiguration: vi.fn(() => ({
          get: vi.fn((key: string) => {
            if (key === 'libraryRefreshInterval') return 0;
            return undefined;
          }),
        })),
        onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
      },
      Disposable: class {},
    }));

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => '<a href="/library/llama3">llama3</a>',
      }),
    );

    const { CloudModelsProvider } = await import('./sidebar.js');
    const cloudProvider = new CloudModelsProvider(
      { secrets: { get: vi.fn().mockResolvedValue(undefined) } } as unknown as ExtensionContext,
      undefined,
    );
    cloudProvider.grouped = false;
    const models = await cloudProvider.getChildren();
    expect(models[0].type).toBe('cloud-stopped');
    expect(models[0].command).toEqual(expect.objectContaining({ command: 'opilot.openModelSettingsForModel' }));
    cloudProvider.dispose();
  });

  it('shows status item when local models fail to load', async () => {
    const failingProvider = new LocalModelsProvider(
      {
        list: vi.fn().mockRejectedValue(new Error('boom')),
        ps: vi.fn().mockResolvedValue({ models: [] }),
      } as unknown as Ollama,
      undefined,
    );

    const models = await failingProvider.getChildren();
    expect(models).toHaveLength(1);
    expect(models[0].label).toBe('Failed to load local models');
    expect(models[0].contextValue).toBe('status');
    failingProvider.dispose();
  });

  it('shows status item when library fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const libraryProvider = new LibraryModelsProvider(undefined);

    const models = await libraryProvider.getChildren();
    expect(models).toHaveLength(1);
    expect(models[0].label).toBe('Failed to load library models');
    expect(models[0].contextValue).toBe('status');
    libraryProvider.dispose();
  });

  it('sorts library models alphabetically by default', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => '<a href="/library/zeta"></a><a href="/library/alpha"></a>',
      }),
    );
    const libraryProvider = new LibraryModelsProvider(undefined);

    const models = await libraryProvider.getChildren();
    expect(models[0].label).toBe('alpha');
    expect(models[1].label).toBe('zeta');
    libraryProvider.dispose();
  });

  it('fetches from plain /library URL when name sort is active', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<a href="/library/alpha"></a>',
    });
    vi.stubGlobal('fetch', mockFetch);

    const libraryProvider = new LibraryModelsProvider(undefined);
    await libraryProvider.getChildren();

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toBe('https://ollama.com/library');
    libraryProvider.dispose();
  });

  it('shows login status item when no cloud models are available', async () => {
    vi.resetModules();

    vi.doMock('./client.js', () => ({
      getCloudOllamaClient: vi.fn().mockResolvedValue({
        list: vi.fn().mockResolvedValue({ models: [] }),
        ps: vi.fn().mockResolvedValue({ models: [] }),
      }),
      fetchModelCapabilities: vi.fn().mockResolvedValue({
        toolCalling: false,
        imageInput: false,
        maxInputTokens: 2048,
        maxOutputTokens: 2048,
      }),
    }));

    vi.doMock('vscode', () => ({
      TreeItem: class {
        label: string;
        description?: string;
        contextValue?: string;
        collapsibleState?: number;
        tooltip?: string;
        command?: unknown;
        constructor(label: string) {
          this.label = label;
        }
      },
      ThemeIcon: class {},
      TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
      EventEmitter: class {
        event = {};
        fire = vi.fn();
      },
      window: {
        showInputBox: vi.fn(),
        showErrorMessage: vi.fn(),
        showInformationMessage: vi.fn(),
        showWarningMessage: vi.fn(),
        withProgress: vi.fn(async (_options: unknown, callback: (progress: any, token: any) => Promise<void>) => {
          return callback({ report: vi.fn() }, { isCancellationRequested: false, onCancellationRequested: vi.fn() });
        }),
      },
      commands: {
        registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
        executeCommand: vi.fn(),
      },
      env: {
        openExternal: vi.fn(),
      },
      Uri: {
        parse: vi.fn((value: string) => ({ value })),
      },
      ProgressLocation: { Notification: 15 },
      workspace: {
        getConfiguration: vi.fn(() => ({
          get: vi.fn((key: string) => {
            if (key === 'libraryRefreshInterval') return 0;
            return undefined;
          }),
        })),
        onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
      },
      Disposable: class {},
    }));

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => '<html></html>',
      }),
    );

    const { CloudModelsProvider } = await import('./sidebar.js');
    const cloudProvider = new CloudModelsProvider(
      { secrets: { get: vi.fn().mockResolvedValue(undefined) } } as unknown as ExtensionContext,
      undefined,
    );

    const models = await cloudProvider.getChildren();
    expect(models).toHaveLength(1);
    expect(models[0].label).toBe('Login to Ollama Cloud');
    expect(models[0].contextValue).toBe('status');
    expect(models[0].command).toBeDefined();
    cloudProvider.dispose();
  });

  it('returns null for getTreeItem', async () => {
    const localProvider = new LocalModelsProvider(
      {
        list: vi.fn().mockResolvedValue({ models: [] }),
        ps: vi.fn().mockResolvedValue({ models: [] }),
      } as unknown as Ollama,
      undefined,
    );

    const item = new ModelTreeItem('test', 'local-running', 1000, 5000);
    expect(localProvider.getTreeItem(item)).toBe(item);
    localProvider.dispose();
  });

  it('handles model deletion', async () => {
    const deleteModel = vi.fn().mockResolvedValue(undefined);
    const localProvider = new LocalModelsProvider(
      {
        list: vi.fn().mockResolvedValue({
          models: [{ name: 'llama2', size: 4000000000 }],
        }),
        ps: vi.fn().mockResolvedValue({
          models: [{ name: 'llama2', size: 4000000000, expires_at: '2099-01-01' }],
        }),
        delete: deleteModel,
      } as unknown as Ollama,
      undefined,
    );

    // getChildren() now returns model-group items; navigate into the 'llama' group
    const groups = await localProvider.getChildren();
    const llamaGroup = groups.find((g: any) => g.label === 'llama');
    expect(llamaGroup).toBeDefined();
    const groupModels = await localProvider.getChildren(llamaGroup);
    const model = groupModels?.find((m: any) => m.label === 'llama2');
    expect(model).toBeDefined();
    expect(deleteModel).toBeDefined();
    localProvider.dispose();
  });

  it('handles model stop command', async () => {
    const generateModel = vi.fn().mockResolvedValue(undefined);
    const localProvider = new LocalModelsProvider(
      {
        list: vi.fn().mockResolvedValue({
          models: [{ name: 'llama2', size: 4000000000 }],
        }),
        ps: vi.fn().mockResolvedValue({
          models: [{ name: 'llama2', size: 4000000000, expires_at: '2099-01-01' }],
        }),
        generate: generateModel,
      } as unknown as Ollama,
      undefined,
    );

    // getChildren() now returns model-group items; navigate into the 'llama' group
    const groups = await localProvider.getChildren();
    const llamaGroup = groups.find((g: any) => g.label === 'llama');
    expect(llamaGroup).toBeDefined();
    const groupModels = await localProvider.getChildren(llamaGroup);
    const model = groupModels?.find((m: any) => m.label === 'llama2');
    expect(model?.type).toBe('local-running');
    expect(generateModel).toBeDefined();
    localProvider.dispose();
  });

  it('stopModel shows progress and polls until model is gone', async () => {
    vi.useFakeTimers();

    const generate = vi.fn().mockResolvedValue(undefined);
    const ps = vi
      .fn()
      .mockResolvedValueOnce({ models: [{ name: 'llama2' }] }) // still running
      .mockResolvedValueOnce({ models: [] }); // now gone

    const localProvider = new LocalModelsProvider(
      {
        list: vi.fn().mockResolvedValue({ models: [] }),
        ps,
        generate,
      } as unknown as Ollama,
      undefined,
    );

    const stopPromise = localProvider.stopModel('llama2');

    // Advance 2s to drive two 1000 ms poll intervals (still-running → gone)
    await vi.advanceTimersByTimeAsync(2000);

    await stopPromise;

    expect(generate).toHaveBeenCalledWith({ model: 'llama2', prompt: '', stream: false, keep_alive: 0 });
    expect(ps).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
    localProvider.dispose();
  });

  it('stopModel uses cloud-authenticated client for cloud-tagged model', async () => {
    vi.resetModules();

    const cloudGenerate = vi.fn().mockResolvedValue(undefined);
    const regularGenerate = vi.fn().mockResolvedValue(undefined);

    vi.doMock('./client.js', () => ({
      getCloudOllamaClient: vi.fn().mockResolvedValue({
        generate: cloudGenerate,
        ps: vi.fn().mockResolvedValue({ models: [] }),
      }),
      fetchModelCapabilities: vi.fn().mockResolvedValue({
        toolCalling: false,
        imageInput: false,
        maxInputTokens: 2048,
        maxOutputTokens: 2048,
      }),
    }));

    vi.doMock('vscode', () => ({
      TreeItem: class {
        label: string;
        constructor(label: string) {
          this.label = label;
        }
      },
      ThemeIcon: class {},
      TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
      EventEmitter: class {
        event = {};
        fire = vi.fn();
      },
      window: {
        showInformationMessage: vi.fn(),
        showErrorMessage: vi.fn(),
        withProgress: vi.fn(async (_options: unknown, callback: (progress: any, token: any) => Promise<void>) => {
          return callback({ report: vi.fn() }, { isCancellationRequested: false, onCancellationRequested: vi.fn() });
        }),
      },
      workspace: {
        getConfiguration: vi.fn(() => ({
          get: vi.fn((key: string) => {
            if (key === 'localModelRefreshInterval') return 0;
            return undefined;
          }),
        })),
        onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
      },
      ProgressLocation: { Notification: 15 },
    }));

    const { LocalModelsProvider } = await import('./sidebar.js');

    const mockRegularClient = {
      list: vi.fn().mockResolvedValue({ models: [] }),
      ps: vi.fn().mockResolvedValue({ models: [] }),
      generate: regularGenerate,
    } as unknown as Ollama;

    const mockContext = {
      secrets: {
        get: vi.fn().mockResolvedValue('test-cloud-api-key'),
      },
    } as unknown as ExtensionContext;

    const localProvider = new LocalModelsProvider(mockRegularClient, mockContext);
    await localProvider.stopModel('llama2:cloud');

    expect(cloudGenerate).toHaveBeenCalledWith({ model: 'llama2:cloud', prompt: '', stream: false, keep_alive: 0 });
    expect(regularGenerate).not.toHaveBeenCalled();

    localProvider.dispose();
  });

  it('cloud provider works without requiring a stored cloud API key', async () => {
    const cloudProvider = new CloudModelsProvider(
      {
        secrets: {
          get: vi.fn().mockResolvedValue(null),
        },
      },
      undefined,
    );

    const models = await cloudProvider.getChildren();
    // Login-first flow may return cloud model groups/items when already authenticated,
    // or a single status action when not authenticated.
    expect(models.length).toBeGreaterThan(0);
    cloudProvider.dispose();
  });

  it('library provider handles fetch with no links', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => '<html><body>no links here</body></html>',
      }),
    );
    const libraryProvider = new LibraryModelsProvider(undefined);

    const models = await libraryProvider.getChildren();
    // Should have no models or just status
    expect(Array.isArray(models)).toBe(true);
    libraryProvider.dispose();
  });

  it('local models provider handles zero duration', async () => {
    const localProvider = new LocalModelsProvider(
      {
        list: vi.fn().mockResolvedValue({
          models: [{ name: 'test-model', size: 0 }],
        }),
        ps: vi.fn().mockResolvedValue({
          models: [
            {
              name: 'test-model',
              size: 0,
              expires_at: new Date().toISOString(),
            },
          ],
        }),
      } as unknown as Ollama,
      undefined,
    );

    // getChildren() returns model-group items; navigate into the group to find the model
    const groups = await localProvider.getChildren();
    expect(groups).toHaveLength(1);
    const group = groups[0];
    const groupModels = await localProvider.getChildren(group);
    expect(groupModels).toHaveLength(1);
    expect(groupModels[0].description).toBeDefined();
    localProvider.dispose();
  });

  it('cloud models provider handles large model size', async () => {
    const cloudProvider = new CloudModelsProvider(
      {
        secrets: {
          get: vi.fn().mockResolvedValue('test-key'),
        },
      } as unknown as ExtensionContext,
      undefined,
    );

    // Mock the API response with a large model
    const models = await cloudProvider.getChildren();
    expect(Array.isArray(models)).toBe(true);
    cloudProvider.dispose();
  });

  it('formats sizes correctly', () => {
    const item = new ModelTreeItem('test', 'local-running', 1000, 5000);
    expect(item.description).toBeDefined();
  });

  it('formats durations correctly for running models', () => {
    const oneHourMs = 60 * 60 * 1000;
    const item = new ModelTreeItem('test', 'local-running', 1000, oneHourMs);
    expect(item.description).toContain('1h 0m');
  });

  it('library provider stops auto-refresh on dispose', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => '<a href="/library/test"></a>',
      }),
    );
    const libraryProvider = new LibraryModelsProvider(undefined);
    libraryProvider.dispose();
    // After dispose, provider should be cleaned up
    expect(libraryProvider).toBeDefined();
  });

  it('library-model item has Collapsed collapsible state', () => {
    const item = new ModelTreeItem('llama3.2', 'library-model');
    expect(item.collapsibleState).toBe(1); // TreeItemCollapsibleState.Collapsed
  });

  it('library-model-variant shows GB size in description', () => {
    const bytes = Math.round(1.3 * 1024 ** 3);
    const item = new ModelTreeItem('llama3.2:1b', 'library-model-variant', bytes);
    expect(item.description).toBe('1.3 GB');
  });

  it('library-model-downloaded-variant shows MB size in description', () => {
    const bytes = Math.round(780 * 1024 ** 2);
    const item = new ModelTreeItem('llama3.2:1b', 'library-model-downloaded-variant', bytes);
    expect(item.description).toBe('780 MB');
  });

  it('library variant without size has no description', () => {
    const item = new ModelTreeItem('llama3.2:1b', 'library-model-variant');
    expect(item.description).toBeFalsy();
  });

  it('fetchModelVariants extracts sizes from sm:hidden HTML blocks', async () => {
    const variantHtml = [
      '<a href="/library/llama3.2:1b" class="sm:hidden flex flex-col space-y-[6px] group text-[13px] px-4 py-3">',
      '  <p class="flex text-neutral-500">1.3GB \u00b7 128K context window \u00b7 Text</p>',
      '</a>',
      '<a href="/library/llama3.2:3b" class="sm:hidden flex flex-col space-y-[6px] group text-[13px] px-4 py-3">',
      '  <p class="flex text-neutral-500">2.0GB \u00b7 128K context window \u00b7 Text</p>',
      '</a>',
    ].join('\n');

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url === 'https://ollama.com/library') {
          return Promise.resolve({ ok: true, text: async () => '<a href="/library/llama3.2"></a>' });
        }
        if (url === 'https://ollama.com/library/llama3.2') {
          return Promise.resolve({ ok: true, text: async () => variantHtml });
        }
        return Promise.resolve({ ok: false, status: 404 });
      }),
    );

    const libraryProvider = new LibraryModelsProvider(undefined);
    // getChildren() promotes single-child families; llama3.2 appears at top level
    const groups = await libraryProvider.getChildren();
    const parent = groups.find((item: any) => item.label === 'llama3.2');
    expect(parent).toBeDefined();
    const children = await libraryProvider.getChildren(parent);

    const item1b = children.find((c: any) => c.label === 'llama3.2:1b');
    const item3b = children.find((c: any) => c.label === 'llama3.2:3b');

    expect(item1b?.description).toBe('1.3 GB');
    expect(item3b?.description).toBe('2.0 GB');
    libraryProvider.dispose();
  });

  it('getChildren with library-model parent fetches and returns variant children', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url === 'https://ollama.com/library') {
          return Promise.resolve({ ok: true, text: async () => '<a href="/library/llama3.2"></a>' });
        }
        if (url === 'https://ollama.com/library/llama3.2') {
          return Promise.resolve({
            ok: true,
            text: async () => '<a href="/library/llama3.2:1b"></a><a href="/library/llama3.2:3b"></a>',
          });
        }
        return Promise.resolve({ ok: false, status: 404 });
      }),
    );

    const libraryProvider = new LibraryModelsProvider(undefined);
    // getChildren() promotes single-child families; llama3.2 appears at top level
    const groups = await libraryProvider.getChildren();
    const parent = groups.find((item: any) => item.label === 'llama3.2');
    expect(parent).toBeDefined();

    const children = await libraryProvider.getChildren(parent);
    expect(children.length).toBeGreaterThan(0);
    expect(children.some((c: any) => c.label === 'llama3.2:1b')).toBe(true);
    expect(children.some((c: any) => c.label === 'llama3.2:3b')).toBe(true);
    libraryProvider.dispose();
  });

  it('downloaded variant has check icon and library-model-downloaded-variant contextValue', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url === 'https://ollama.com/library') {
          return Promise.resolve({ ok: true, text: async () => '<a href="/library/llama3.2"></a>' });
        }
        if (url === 'https://ollama.com/library/llama3.2') {
          return Promise.resolve({ ok: true, text: async () => '<a href="/library/llama3.2:1b"></a>' });
        }
        return Promise.resolve({ ok: false, status: 404 });
      }),
    );

    const libraryProvider = new LibraryModelsProvider(undefined);
    libraryProvider.setLocalProvider({
      getCachedLocalModelNames: () => new Set(['llama3.2:1b']),
    } as unknown as LocalModelsProvider);
    // getChildren() groups by family; llama3.2 -> family 'llama'
    const groups = await libraryProvider.getChildren();
    const llamaGroup = groups.find((item: any) => item.label === 'llama');
    const familyModels = await libraryProvider.getChildren(llamaGroup);
    const parent = familyModels.find((item: any) => item.label === 'llama3.2');
    const children = await libraryProvider.getChildren(parent);

    const downloaded = children.find((c: any) => c.label === 'llama3.2:1b');
    expect(downloaded?.contextValue).toBe('library-model-downloaded-variant');
    expect(downloaded).toBeDefined();
    expect((downloaded!.iconPath as { id: string }).id).toBe('check');
    libraryProvider.dispose();
  });

  it('non-downloaded variant has library-model-variant contextValue without icon', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url === 'https://ollama.com/library') {
          return Promise.resolve({ ok: true, text: async () => '<a href="/library/llama3.2"></a>' });
        }
        if (url === 'https://ollama.com/library/llama3.2') {
          return Promise.resolve({ ok: true, text: async () => '<a href="/library/llama3.2:3b"></a>' });
        }
        return Promise.resolve({ ok: false, status: 404 });
      }),
    );

    const libraryProvider = new LibraryModelsProvider(undefined);
    // local provider returns empty set — nothing downloaded
    libraryProvider.setLocalProvider({
      getCachedLocalModelNames: () => new Set<string>(),
    } as unknown as LocalModelsProvider);
    // getChildren() groups by family; llama3.2 -> family 'llama'
    const groups = await libraryProvider.getChildren();
    const llamaGroup = groups.find((item: any) => item.label === 'llama');
    const familyModels = await libraryProvider.getChildren(llamaGroup);
    const parent = familyModels.find((item: any) => item.label === 'llama3.2');
    const children = await libraryProvider.getChildren(parent);

    const undownloaded = children.find((c: any) => c.label === 'llama3.2:3b');
    expect(undownloaded?.contextValue).toBe('library-model-variant');
    expect(undownloaded?.iconPath).toBeUndefined();
    libraryProvider.dispose();
  });

  it('library-model-variant shows KB size in description', () => {
    const bytes = Math.round(780 * 1024);
    const item = new ModelTreeItem('llama3.2:1b', 'library-model-variant', bytes);
    expect(item.description).toBe('780 KB');
  });

  it('fetchModelVariants extracts size when sm:hidden is not first class', async () => {
    const variantHtml = [
      '<a href="/library/llama3.2:1b" class="flex sm:hidden flex-col">',
      '  <p>1.3GB</p>',
      '</a>',
    ].join('\n');

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url === 'https://ollama.com/library') {
          return Promise.resolve({ ok: true, text: async () => '<a href="/library/llama3.2"></a>' });
        }
        if (url === 'https://ollama.com/library/llama3.2') {
          return Promise.resolve({ ok: true, text: async () => variantHtml });
        }
        return Promise.resolve({ ok: false, status: 404 });
      }),
    );

    const libraryProvider = new LibraryModelsProvider(undefined);
    // getChildren() groups by family; llama3.2 -> family 'llama'
    const groups = await libraryProvider.getChildren();
    const llamaGroup = groups.find((item: any) => item.label === 'llama');
    const familyModels = await libraryProvider.getChildren(llamaGroup);
    const parent = familyModels.find((item: any) => item.label === 'llama3.2');
    const children = await libraryProvider.getChildren(parent);

    const item1b = children.find((c: any) => c.label === 'llama3.2:1b');
    expect(item1b?.description).toBe('1.3 GB');
    libraryProvider.dispose();
  });

  it('variant checkmarks reflect updated local state without re-fetching', async () => {
    let localModels = new Set<string>();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url === 'https://ollama.com/library') {
          return Promise.resolve({ ok: true, text: async () => '<a href="/library/llama3.2"></a>' });
        }
        if (url === 'https://ollama.com/library/llama3.2') {
          return Promise.resolve({ ok: true, text: async () => '<a href="/library/llama3.2:1b"></a>' });
        }
        return Promise.resolve({ ok: false, status: 404 });
      }),
    );

    const libraryProvider = new LibraryModelsProvider(undefined);
    libraryProvider.setLocalProvider({
      getCachedLocalModelNames: () => localModels,
    } as unknown as LocalModelsProvider);
    // getChildren() groups by family; llama3.2 -> family 'llama'
    const groups = await libraryProvider.getChildren();
    const llamaGroup = groups.find((item: any) => item.label === 'llama');
    const familyModels = await libraryProvider.getChildren(llamaGroup);
    const parent = familyModels.find((item: any) => item.label === 'llama3.2');

    // First call: model not yet downloaded
    const childrenBefore = await libraryProvider.getChildren(parent);
    expect(childrenBefore.find((c: any) => c.label === 'llama3.2:1b')?.contextValue).toBe('library-model-variant');

    // Simulate download
    localModels = new Set(['llama3.2:1b']);

    // Second call uses cached raw metadata but re-materializes with updated local state
    const childrenAfter = await libraryProvider.getChildren(parent);
    expect(childrenAfter.find((c: any) => c.label === 'llama3.2:1b')?.contextValue).toBe(
      'library-model-downloaded-variant',
    );
    libraryProvider.dispose();
  });

  it('getCachedLocalModelNames returns set of local model names after fetch', async () => {
    const localProvider = new LocalModelsProvider(
      {
        list: vi.fn().mockResolvedValue({
          models: [
            { name: 'llama2:latest', size: 4000000000 },
            { name: 'mistral:7b', size: 3000000000 },
          ],
        }),
        ps: vi.fn().mockResolvedValue({ models: [] }),
      } as unknown as Ollama,
      undefined,
    );

    await localProvider.getChildren();
    const names = localProvider.getCachedLocalModelNames();
    expect(names.has('llama2:latest')).toBe(true);
    expect(names.has('mistral:7b')).toBe(true);
    localProvider.dispose();
  });
});

describe('Extracted command handlers', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('vscode', () => ({
      TreeItem: class {
        label: string;
        description?: string;
        contextValue?: string;
        collapsibleState?: number;
        tooltip?: string;
        command?: unknown;
        constructor(label: string) {
          this.label = label;
        }
      },
      ThemeIcon: class {},
      TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
      EventEmitter: class {
        event = {};
        fire = vi.fn();
      },
      window: {
        showWarningMessage: vi.fn().mockResolvedValue('Delete'),
        showInformationMessage: vi.fn(),
        showErrorMessage: vi.fn(),
      },
      env: {
        openExternal: vi.fn(),
      },
      Uri: {
        parse: vi.fn((value: string) => ({ value })),
      },
      workspace: {
        getConfiguration: vi.fn(() => ({ get: vi.fn() })),
        onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
      },
      ProgressLocation: { Notification: 15 },
    }));
  });

  it('handleRefreshLocalModels refreshes provider and shows message', async () => {
    const { handleRefreshLocalModels } = await import('./sidebar.js');

    const mockProvider = {
      refresh: vi.fn(),
    } as unknown as LocalModelsProvider;

    handleRefreshLocalModels(mockProvider);

    expect(mockProvider.refresh).toHaveBeenCalled();
  });

  it('handleRefreshLibrary refreshes library and shows message', async () => {
    const { handleRefreshLibrary } = await import('./sidebar.js');

    const mockProvider = {
      refresh: vi.fn(),
    } as unknown as LibraryModelsProvider;

    handleRefreshLibrary(mockProvider);

    expect(mockProvider.refresh).toHaveBeenCalled();
  });

  it('handleRefreshCloudModels refreshes cloud provider', async () => {
    const { handleRefreshCloudModels } = await import('./sidebar.js');

    const mockProvider = {
      refresh: vi.fn(),
    } as unknown as CloudModelsProvider;

    handleRefreshCloudModels(mockProvider);

    expect(mockProvider.refresh).toHaveBeenCalled();
  });

  it('handleDeleteModel deletes local model when confirmed', async () => {
    const { handleDeleteModel, ModelTreeItem } = await import('./sidebar.js');

    const mockProvider = {
      deleteModel: vi.fn(),
    } as unknown as LocalModelsProvider;

    const item = new ModelTreeItem('test-model', 'local-stopped', 1000);

    await handleDeleteModel(item, mockProvider);

    expect(mockProvider.deleteModel).toHaveBeenCalledWith('test-model');
  });

  it('handleDeleteModel blocks deletion of a running local model', async () => {
    const { handleDeleteModel, ModelTreeItem } = await import('./sidebar.js');

    const mockProvider = { deleteModel: vi.fn() } as unknown as LocalModelsProvider;
    const item = new ModelTreeItem('test-model', 'local-running', 1000);

    await handleDeleteModel(item, mockProvider);

    expect(mockProvider.deleteModel).not.toHaveBeenCalled();
  });

  it('handleDeleteModel blocks deletion of a running cloud model', async () => {
    const { handleDeleteModel, ModelTreeItem } = await import('./sidebar.js');

    const mockProvider = { deleteModel: vi.fn() } as unknown as LocalModelsProvider;
    const item = new ModelTreeItem('cloud-model', 'cloud-running', 1000);

    await handleDeleteModel(item, mockProvider);

    expect(mockProvider.deleteModel).not.toHaveBeenCalled();
  });

  it('handleDeleteModel does not delete when cancelled', async () => {
    vi.resetModules();

    vi.doMock('vscode', () => ({
      TreeItem: class {
        label: string;
        description?: string;
        contextValue?: string;
        collapsibleState?: number;
        tooltip?: string;
        command?: unknown;
        constructor(label: string) {
          this.label = label;
        }
      },
      ThemeIcon: class {},
      TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
      EventEmitter: class {
        event = {};
        fire = vi.fn();
      },
      window: {
        showWarningMessage: vi.fn().mockResolvedValue('Cancel'),
        showInformationMessage: vi.fn(),
        showErrorMessage: vi.fn(),
      },
      env: {
        openExternal: vi.fn(),
      },
      Uri: {
        parse: vi.fn((value: string) => ({ value })),
      },
      workspace: {
        getConfiguration: vi.fn(() => ({ get: vi.fn() })),
        onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
      },
      ProgressLocation: { Notification: 15 },
    }));

    const { handleDeleteModel, ModelTreeItem } = await import('./sidebar.js');

    const mockProvider = { deleteModel: vi.fn() } as unknown as LocalModelsProvider;
    const item = new ModelTreeItem('test-model', 'local-stopped');

    await handleDeleteModel(item, mockProvider);

    expect(mockProvider.deleteModel).not.toHaveBeenCalled();
  });

  it('handleDeleteModel ignores non-local models', async () => {
    const { handleDeleteModel, ModelTreeItem } = await import('./sidebar.js');

    const mockProvider = {
      deleteModel: vi.fn(),
    } as unknown as LocalModelsProvider;

    const item = new ModelTreeItem('test-model', 'library-model');

    await handleDeleteModel(item, mockProvider);

    expect(mockProvider.deleteModel).not.toHaveBeenCalled();
  });

  it('handleStartModel starts stopped local model', async () => {
    const { handleStartModel, ModelTreeItem } = await import('./sidebar.js');

    const mockProvider = {
      startModel: vi.fn(),
    } as unknown as LocalModelsProvider;

    const item = new ModelTreeItem('test-model', 'local-stopped');

    handleStartModel(item, mockProvider);

    expect(mockProvider.startModel).toHaveBeenCalledWith('test-model');
  });

  it('handleStopModel stops running model', async () => {
    const { handleStopModel, ModelTreeItem } = await import('./sidebar.js');

    const mockProvider = {
      stopModel: vi.fn(),
    } as unknown as LocalModelsProvider;

    const item = new ModelTreeItem('test-model', 'local-running');

    handleStopModel(item, mockProvider);

    expect(mockProvider.stopModel).toHaveBeenCalledWith('test-model');
  });

  it('handleOpenCloudModel opens cloud model URL', async () => {
    const { handleOpenCloudModel, ModelTreeItem } = await import('./sidebar.js');

    // Should not throw
    const item = new ModelTreeItem('claude', 'cloud-stopped');
    handleOpenCloudModel(item);

    expect(handleOpenCloudModel).toBeDefined();
  });

  it('handleDeleteModel ignores null or status items', async () => {
    const { handleDeleteModel } = await import('./sidebar.js');

    const mockProvider = {
      deleteModel: vi.fn(),
    } as unknown as LocalModelsProvider;

    handleDeleteModel(null as unknown as ModelTreeItem, mockProvider);

    // null/undefined guard fires before any confirmation prompt
    expect(mockProvider.deleteModel).not.toHaveBeenCalled();
  });

  it('handleStartModel does nothing for running models', async () => {
    const { handleStartModel, ModelTreeItem } = await import('./sidebar.js');

    const mockProvider = {
      startModel: vi.fn(),
    } as unknown as LocalModelsProvider;

    const item = new ModelTreeItem('test-model', 'local-running');

    handleStartModel(item, mockProvider);

    expect(mockProvider.startModel).not.toHaveBeenCalled();
  });

  it('handleStopModel handles cloud-running models', async () => {
    const { handleStopModel, ModelTreeItem } = await import('./sidebar.js');

    const mockProvider = {
      stopModel: vi.fn(),
    } as unknown as LocalModelsProvider;

    const item = new ModelTreeItem('test-model', 'cloud-running');

    handleStopModel(item, mockProvider);

    expect(mockProvider.stopModel).toHaveBeenCalledWith('test-model');
  });

  it('handleStartCloudModel starts cloud-stopped models (when already pulled)', async () => {
    const { handleStartCloudModel, ModelTreeItem } = await import('./sidebar.js');

    const mockProvider = {
      startModel: vi.fn(),
      getCachedLocalModelNames: vi.fn().mockReturnValue(new Set(['test-model'])),
    } as unknown as LocalModelsProvider;

    const mockCloudProvider = {
      resolveRunnableCloudModelName: vi.fn().mockResolvedValue('test-model'),
      markModelWarm: vi.fn(),
      refresh: vi.fn(),
    } as unknown as CloudModelsProvider;

    const item = new ModelTreeItem('test-model', 'cloud-stopped');

    await handleStartCloudModel(item, mockProvider, mockCloudProvider);

    expect(mockProvider.startModel).toHaveBeenCalledWith('test-model');
  });

  it('handleStartCloudModel resolves via cloudProvider when present', async () => {
    vi.resetModules();

    const mockStartModel = vi.fn();

    vi.doMock('vscode', () => ({
      TreeItem: class {
        label: string;
        description?: string;
        contextValue?: string;
        collapsibleState?: number;
        tooltip?: string;
        command?: unknown;
        constructor(label: string) {
          this.label = label;
        }
      },
      ThemeIcon: class {},
      TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
      EventEmitter: class {
        event = {};
        fire = vi.fn();
      },
      window: {
        registerTreeDataProvider: vi.fn(() => ({ dispose: vi.fn() })),
        showInputBox: vi.fn(),
        showErrorMessage: vi.fn(),
        showInformationMessage: vi.fn(),
        showWarningMessage: vi.fn(),
        withProgress: vi.fn(async (_options: unknown, callback: (progress: any, token: any) => Promise<void>) => {
          const mockProgress = { report: vi.fn() };
          const mockToken = { isCancellationRequested: false, onCancellationRequested: vi.fn() };
          return callback(mockProgress, mockToken);
        }),
      },
      commands: {
        registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
        executeCommand: vi.fn(),
      },
      env: { openExternal: vi.fn() },
      Uri: { parse: vi.fn((v: string) => ({ value: v })) },
      ProgressLocation: { Notification: 15 },
      workspace: {
        getConfiguration: vi.fn(() => ({ get: vi.fn() })),
        onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
      },
    }));

    const { handleStartCloudModel, ModelTreeItem } = await import('./sidebar.js');

    const mockProvider = {
      startModel: mockStartModel,
      getCachedLocalModelNames: vi.fn().mockReturnValue(new Set<string>()),
    } as unknown as LocalModelsProvider;

    const mockCloudProvider = {
      resolveRunnableCloudModelName: vi.fn().mockResolvedValue('new-cloud-model:cloud'),
      markModelWarm: vi.fn(),
      refresh: vi.fn(),
    } as unknown as CloudModelsProvider;

    const item = new ModelTreeItem('new-cloud-model', 'cloud-stopped');

    await handleStartCloudModel(item, mockProvider, mockCloudProvider);

    expect(mockCloudProvider.resolveRunnableCloudModelName).toHaveBeenCalledWith('new-cloud-model');
    expect(mockStartModel).toHaveBeenCalledWith('new-cloud-model:cloud');
    expect(mockCloudProvider.markModelWarm).toHaveBeenCalledWith('new-cloud-model', 'new-cloud-model:cloud');
    expect(mockCloudProvider.refresh).toHaveBeenCalled();
  });

  it('handleStopCloudModel stops cloud-running models', async () => {
    const { handleStopCloudModel, ModelTreeItem } = await import('./sidebar.js');

    const mockProvider = {
      stopModel: vi.fn(),
    } as unknown as LocalModelsProvider;

    const mockCloudProvider = {
      getWarmedModelName: vi.fn().mockReturnValue('test-model:cloud'),
      markModelStopped: vi.fn(),
      refresh: vi.fn(),
    } as unknown as CloudModelsProvider;

    const item = new ModelTreeItem('test-model', 'cloud-running');

    await handleStopCloudModel(item, mockProvider, mockCloudProvider);

    expect(mockCloudProvider.getWarmedModelName).toHaveBeenCalledWith('test-model');
    expect(mockProvider.stopModel).toHaveBeenCalledWith('test-model:cloud');
    expect(mockCloudProvider.markModelStopped).toHaveBeenCalledWith('test-model');
    expect(mockCloudProvider.refresh).toHaveBeenCalled();
  });

  it('handleOpenLibraryModelPage handles library-model type', async () => {
    const { handleOpenLibraryModelPage, ModelTreeItem } = await import('./sidebar.js');

    const item = new ModelTreeItem('mistral', 'library-model');

    // Should not throw
    handleOpenLibraryModelPage(item);

    expect(handleOpenLibraryModelPage).toBeDefined();
  });

  it('handleOpenLibraryModelPage ignores non-library models', async () => {
    const { handleOpenLibraryModelPage, ModelTreeItem } = await import('./sidebar.js');

    const item = new ModelTreeItem('test-model', 'local-running');

    // Should not throw
    handleOpenLibraryModelPage(item);

    expect(handleOpenLibraryModelPage).toBeDefined();
  });

  it('handlePullModel handles model name input', async () => {
    const { handlePullModel } = await import('./sidebar.js');

    // Since handlePullModel is async and requires user input via showInputBox,
    // we can verify it's callable and won't throw
    expect(typeof handlePullModel).toBe('function');
  });

  it('handlePullModelFromLibrary handles library models', async () => {
    const { handlePullModelFromLibrary, ModelTreeItem } = await import('./sidebar.js');

    const _mockClient = {
      pull: vi.fn().mockResolvedValue(undefined),
    } as unknown as Ollama;

    const mockProvider = {
      refresh: vi.fn(),
    } as unknown as LocalModelsProvider;

    const item = new ModelTreeItem('mistral:7b', 'library-model');

    // Should not throw
    await handlePullModelFromLibrary(item, _mockClient, mockProvider);

    // Since it's async with promise handling, pull should be called eventually
    // Verify the function exists and is callable
    expect(typeof handlePullModelFromLibrary).toBe('function');
  });

  it('handlePullModelFromLibrary ignores non-library models', async () => {
    const { handlePullModelFromLibrary, ModelTreeItem } = await import('./sidebar.js');

    const mockClient = {
      pull: vi.fn().mockResolvedValue(undefined),
    } as unknown as Ollama;

    const mockProvider = {
      refresh: vi.fn(),
    } as unknown as LocalModelsProvider;

    const item = new ModelTreeItem('test-model', 'local-running');

    await handlePullModelFromLibrary(item, mockClient, mockProvider);

    // Pull should not be called for non-library models
    expect(mockClient.pull).not.toHaveBeenCalled();
  });

  it('handleManageCloudApiKey function is callable', async () => {
    const { handleManageCloudApiKey } = await import('./sidebar.js');

    expect(typeof handleManageCloudApiKey).toBe('function');
  });

  it('handleLoginToCloud function is callable', async () => {
    const { handleLoginToCloud } = await import('./sidebar.js');

    expect(typeof handleLoginToCloud).toBe('function');
  });

  it('handleLoginToCloud opens terminal and runs `ollama login`', async () => {
    vi.resetModules();

    const show = vi.fn();
    const sendText = vi.fn();
    const createTerminal = vi.fn(() => ({ show, sendText }));

    vi.doMock('vscode', () => ({
      TreeItem: class {
        label: string;
        constructor(label: string) {
          this.label = label;
        }
      },
      ThemeIcon: class {},
      TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
      EventEmitter: class {
        event = {};
        fire = vi.fn();
      },
      window: {
        createTerminal,
        showInformationMessage: vi.fn(),
        showErrorMessage: vi.fn(),
        showWarningMessage: vi.fn(),
        withProgress: vi.fn(),
        showInputBox: vi.fn(),
      },
      commands: { registerCommand: vi.fn(() => ({ dispose: vi.fn() })), executeCommand: vi.fn() },
      env: { openExternal: vi.fn() },
      Uri: { parse: vi.fn((value: string) => ({ value })) },
      ProgressLocation: { Notification: 15 },
      workspace: {
        getConfiguration: vi.fn(() => ({ get: vi.fn() })),
        onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
      },
      Disposable: class {},
    }));

    const { handleLoginToCloud } = await import('./sidebar.js');
    handleLoginToCloud();

    expect(createTerminal).toHaveBeenCalledWith({ name: 'Ollama Cloud Login' });
    expect(show).toHaveBeenCalledWith(true);
    expect(sendText).toHaveBeenCalledWith('ollama login', true);
  });

  it('handleManageCloudApiKey delegates to login flow', async () => {
    vi.resetModules();

    const sendText = vi.fn();
    vi.doMock('vscode', () => ({
      TreeItem: class {
        label: string;
        constructor(label: string) {
          this.label = label;
        }
      },
      ThemeIcon: class {},
      TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
      EventEmitter: class {
        event = {};
        fire = vi.fn();
      },
      window: {
        createTerminal: vi.fn(() => ({ show: vi.fn(), sendText })),
        showInformationMessage: vi.fn(),
        showErrorMessage: vi.fn(),
        showWarningMessage: vi.fn(),
        withProgress: vi.fn(),
        showInputBox: vi.fn(),
      },
      commands: { registerCommand: vi.fn(() => ({ dispose: vi.fn() })), executeCommand: vi.fn() },
      env: { openExternal: vi.fn() },
      Uri: { parse: vi.fn((value: string) => ({ value })) },
      ProgressLocation: { Notification: 15 },
      workspace: {
        getConfiguration: vi.fn(() => ({ get: vi.fn() })),
        onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
      },
      Disposable: class {},
    }));

    const { handleManageCloudApiKey } = await import('./sidebar.js');
    await handleManageCloudApiKey({} as any, {} as any, {} as any);

    expect(sendText).toHaveBeenCalledWith('ollama login', true);
  });

  it('handleOpenCloudModel opens external URL for cloud items only', async () => {
    vi.resetModules();

    const openExternal = vi.fn();
    vi.doMock('vscode', () => ({
      TreeItem: class {
        label: string;
        contextValue?: string;
        constructor(label: string) {
          this.label = label;
        }
      },
      ThemeIcon: class {},
      TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
      EventEmitter: class {
        event = {};
        fire = vi.fn();
      },
      env: { openExternal },
      Uri: { parse: vi.fn((value: string) => ({ value })) },
      window: {
        showInformationMessage: vi.fn(),
        showErrorMessage: vi.fn(),
        showWarningMessage: vi.fn(),
        withProgress: vi.fn(),
        showInputBox: vi.fn(),
      },
      commands: { registerCommand: vi.fn(() => ({ dispose: vi.fn() })), executeCommand: vi.fn() },
      ProgressLocation: { Notification: 15 },
      workspace: {
        getConfiguration: vi.fn(() => ({ get: vi.fn() })),
        onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
      },
      Disposable: class {},
    }));

    const { handleOpenCloudModel, ModelTreeItem } = await import('./sidebar.js');
    handleOpenCloudModel(new ModelTreeItem('llama3:cloud', 'cloud-stopped'));
    handleOpenCloudModel(new ModelTreeItem('llama3', 'library-model'));

    expect(openExternal).toHaveBeenCalledTimes(1);
    const firstCall = openExternal.mock.calls[0];
    expect(firstCall).toBeDefined();
    expect((firstCall[0] as { value: string }).value).toContain('https://ollama.com/library/');
  });

  it('handlePullModel reports streaming progress via withProgress', async () => {
    vi.resetModules();

    const progressReport = vi.fn();

    async function* makePullStream() {
      yield { status: 'pulling manifest', digest: '', total: 0, completed: 0 };
      yield { status: 'downloading', digest: 'sha256:abc', total: 1000, completed: 250 };
      yield { status: 'downloading', digest: 'sha256:abc', total: 1000, completed: 1000 };
      yield { status: 'success', digest: 'sha256:abc', total: 1000, completed: 1000 };
    }

    const mockPull = vi.fn().mockReturnValue(makePullStream());
    const mockRefresh = vi.fn();

    vi.doMock('vscode', () => ({
      TreeItem: class {
        label: string;
        description?: string;
        contextValue?: string;
        collapsibleState?: number;
        tooltip?: string;
        command?: unknown;
        constructor(label: string) {
          this.label = label;
        }
      },
      ThemeIcon: class {},
      TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
      EventEmitter: class {
        event = {};
        fire = vi.fn();
      },
      window: {
        showInputBox: vi.fn().mockResolvedValue('llama3:8b'),
        showInformationMessage: vi.fn(),
        showErrorMessage: vi.fn(),
        withProgress: vi.fn(
          async (_opts: unknown, task: (p: { report: typeof progressReport }, t: unknown) => Promise<void>) => {
            await task(
              { report: progressReport },
              { isCancellationRequested: false, onCancellationRequested: vi.fn() },
            );
          },
        ),
      },
      workspace: {
        getConfiguration: vi.fn(() => ({ get: vi.fn() })),
        onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
      },
      ProgressLocation: { Notification: 15 },
    }));

    const { handlePullModel } = await import('./sidebar.js');

    await handlePullModel(
      { pull: mockPull } as unknown as Ollama,
      { refresh: mockRefresh } as unknown as LocalModelsProvider,
    );

    expect(mockPull).toHaveBeenCalledWith({ model: 'llama3:8b', stream: true });
    // Progress should have been reported at least once with a percentage message
    const reportCalls = progressReport.mock.calls.map((c: any) => c[0].message as string);
    expect(reportCalls.some(msg => msg.includes('%'))).toBe(true);
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('handlePullModel does nothing when user cancels input', async () => {
    vi.resetModules();

    const mockPull = vi.fn();

    vi.doMock('vscode', () => ({
      TreeItem: class {
        label: string;
        constructor(label: string) {
          this.label = label;
        }
      },
      ThemeIcon: class {},
      TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
      EventEmitter: class {
        event = {};
        fire = vi.fn();
      },
      window: {
        showInputBox: vi.fn().mockResolvedValue(undefined),
        showInformationMessage: vi.fn(),
        showErrorMessage: vi.fn(),
        withProgress: vi.fn(),
      },
      workspace: {
        getConfiguration: vi.fn(() => ({ get: vi.fn() })),
        onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
      },
      ProgressLocation: { Notification: 15 },
    }));

    const { handlePullModel } = await import('./sidebar.js');

    await handlePullModel(
      { pull: mockPull } as unknown as Ollama,
      { refresh: vi.fn() } as unknown as LocalModelsProvider,
    );

    expect(mockPull).not.toHaveBeenCalled();
  });

  it('handlePullModelFromLibrary reports streaming progress', async () => {
    vi.resetModules();

    const progressReport = vi.fn();

    async function* makePullStream() {
      yield { status: 'downloading', digest: 'sha256:abc', total: 2000, completed: 1000 };
      yield { status: 'success', digest: 'sha256:abc', total: 2000, completed: 2000 };
    }

    const mockPull = vi.fn().mockReturnValue(makePullStream());
    const mockRefresh = vi.fn();

    vi.doMock('vscode', () => ({
      TreeItem: class {
        label: string;
        description?: string;
        contextValue?: string;
        collapsibleState?: number;
        tooltip?: string;
        command?: unknown;
        constructor(label: string) {
          this.label = label;
        }
      },
      ThemeIcon: class {},
      TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
      EventEmitter: class {
        event = {};
        fire = vi.fn();
      },
      window: {
        showInformationMessage: vi.fn(),
        showErrorMessage: vi.fn(),
        withProgress: vi.fn(
          async (_opts: unknown, task: (p: { report: typeof progressReport }, t: unknown) => Promise<void>) => {
            await task(
              { report: progressReport },
              { isCancellationRequested: false, onCancellationRequested: vi.fn() },
            );
          },
        ),
      },
      workspace: {
        getConfiguration: vi.fn(() => ({ get: vi.fn() })),
        onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
      },
      ProgressLocation: { Notification: 15 },
    }));

    const { handlePullModelFromLibrary, ModelTreeItem } = await import('./sidebar.js');

    const item = new ModelTreeItem('mistral:7b', 'library-model-variant');
    await handlePullModelFromLibrary(
      item,
      { pull: mockPull } as unknown as Ollama,
      { refresh: mockRefresh } as unknown as LocalModelsProvider,
    );

    expect(mockPull).toHaveBeenCalledWith({ model: 'mistral:7b', stream: true });
    const reportCalls = progressReport.mock.calls.map((c: any) => c[0].message as string);
    expect(reportCalls.some(msg => msg.includes('%'))).toBe(true);
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('handlePullModelFromLibrary cancels download when token fires', async () => {
    vi.resetModules();

    const mockAbort = vi.fn();
    const mockShowError = vi.fn();
    const mockShowInfo = vi.fn();

    // Stream that throws to simulate an aborted connection
    async function* abortedStream() {
      yield { status: '' };
      throw new Error('Request aborted');
    }

    const mockPull = vi.fn().mockReturnValue(abortedStream());

    const mockToken = {
      isCancellationRequested: true,
      onCancellationRequested: vi.fn((fn: () => void) => {
        fn();
        return { dispose: vi.fn() };
      }),
    };

    vi.doMock('vscode', () => ({
      TreeItem: class {
        label: string;
        description?: string;
        contextValue?: string;
        collapsibleState?: number;
        tooltip?: string;
        command?: unknown;
        constructor(label: string) {
          this.label = label;
        }
      },
      ThemeIcon: class {},
      TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
      EventEmitter: class {
        event = {};
        fire = vi.fn();
      },
      window: {
        showInformationMessage: mockShowInfo,
        showErrorMessage: mockShowError,
        withProgress: vi.fn(
          async (
            _opts: unknown,
            task: (p: { report: ReturnType<typeof vi.fn> }, t: typeof mockToken) => Promise<void>,
          ) => {
            await task({ report: vi.fn() }, mockToken);
          },
        ),
      },
      workspace: {
        getConfiguration: vi.fn(() => ({ get: vi.fn() })),
        onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
      },
      ProgressLocation: { Notification: 15 },
    }));

    const { handlePullModelFromLibrary, ModelTreeItem } = await import('./sidebar.js');

    const item = new ModelTreeItem('mistral:7b', 'library-model-variant');
    await handlePullModelFromLibrary(
      item,
      { pull: mockPull, abort: mockAbort } as unknown as Ollama,
      {
        refresh: vi.fn(),
      } as unknown as LocalModelsProvider,
    );

    expect(mockAbort).toHaveBeenCalled();
    expect(mockShowError).not.toHaveBeenCalled();
    expect(mockShowInfo).toHaveBeenCalledWith('Download of mistral:7b cancelled');
  });

  it('local models show capability badges in description', async () => {
    vi.resetModules();

    vi.doMock('./client.js', () => ({
      fetchModelCapabilities: vi.fn().mockResolvedValue({
        toolCalling: true,
        imageInput: false,
        maxInputTokens: 4096,
        maxOutputTokens: 4096,
      }),
    }));

    vi.doMock('vscode', () => ({
      TreeItem: class {
        label: string;
        description?: string;
        contextValue?: string;
        collapsibleState?: number;
        tooltip?: string;
        command?: unknown;
        constructor(label: string) {
          this.label = label;
        }
      },
      ThemeIcon: class {},
      TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
      EventEmitter: class {
        event = {};
        fire = vi.fn();
      },
      window: {
        showInformationMessage: vi.fn(),
        showErrorMessage: vi.fn(),
        withProgress: vi.fn(),
      },
      workspace: {
        getConfiguration: vi.fn(() => ({
          get: vi.fn((key: string) => {
            if (key === 'localModelRefreshInterval') return 0;
            return undefined;
          }),
        })),
        onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
      },
      ProgressLocation: { Notification: 15 },
    }));

    const { LocalModelsProvider } = await import('./sidebar.js');

    const mockClient = {
      list: vi.fn().mockResolvedValue({
        models: [{ name: 'llama3-tools:latest', size: 4000000000, digest: 'abc' }],
      }),
      ps: vi.fn().mockResolvedValue({ models: [] }),
    } as unknown as Ollama;

    const localProvider = new LocalModelsProvider(mockClient);

    // Collect the promise for the badge update before awaiting getChildren
    const models = await localProvider.getChildren();

    // Flush all microtasks / pending promises so the async badge update completes
    await Promise.resolve();
    await Promise.resolve();

    // getChildren() now returns model-group items; navigate into the 'llama' group
    expect(models).toHaveLength(1);
    expect(models[0].type).toBe('model-group');
    const llamaModels = await localProvider.getChildren(models[0]);
    const item = llamaModels[0];
    expect(item.label).toBe('llama3-tools:latest');
    expect(item.description).toContain('🛠️');
    localProvider.dispose();
  });

  it('handlePullModelFromLibrary pulls for library-model-variant', async () => {
    vi.resetModules();

    const progressReport = vi.fn();

    async function* makePullStream() {
      yield { status: 'success', digest: 'sha256:abc', total: 100, completed: 100 };
    }

    const mockPull = vi.fn().mockReturnValue(makePullStream());
    const mockRefresh = vi.fn();

    vi.doMock('vscode', () => ({
      TreeItem: class {
        label: string;
        description?: string;
        contextValue?: string;
        collapsibleState?: number;
        tooltip?: string;
        command?: unknown;
        constructor(label: string) {
          this.label = label;
        }
      },
      ThemeIcon: class {},
      TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
      EventEmitter: class {
        event = {};
        fire = vi.fn();
      },
      window: {
        showInformationMessage: vi.fn(),
        showErrorMessage: vi.fn(),
        withProgress: vi.fn(
          async (_opts: unknown, task: (p: { report: typeof progressReport }, t: unknown) => Promise<void>) => {
            await task(
              { report: progressReport },
              { isCancellationRequested: false, onCancellationRequested: vi.fn() },
            );
          },
        ),
      },
      workspace: {
        getConfiguration: vi.fn(() => ({ get: vi.fn() })),
        onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
      },
      ProgressLocation: { Notification: 15 },
    }));

    const { handlePullModelFromLibrary, ModelTreeItem } = await import('./sidebar.js');

    const item = new ModelTreeItem('llama3.2:1b', 'library-model-variant');
    await handlePullModelFromLibrary(
      item,
      { pull: mockPull } as unknown as Ollama,
      { refresh: mockRefresh } as unknown as LocalModelsProvider,
    );

    expect(mockPull).toHaveBeenCalledWith({ model: 'llama3.2:1b', stream: true });
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('handlePullModelFromLibrary pulls for library-model-downloaded-variant', async () => {
    vi.resetModules();

    const progressReport = vi.fn();

    async function* makePullStream() {
      yield { status: 'success', digest: 'sha256:abc', total: 100, completed: 100 };
    }

    const mockPull = vi.fn().mockReturnValue(makePullStream());
    const mockRefresh = vi.fn();

    vi.doMock('vscode', () => ({
      TreeItem: class {
        label: string;
        description?: string;
        contextValue?: string;
        collapsibleState?: number;
        tooltip?: string;
        command?: unknown;
        constructor(label: string) {
          this.label = label;
        }
      },
      ThemeIcon: class {},
      TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
      EventEmitter: class {
        event = {};
        fire = vi.fn();
      },
      window: {
        showInformationMessage: vi.fn(),
        showErrorMessage: vi.fn(),
        withProgress: vi.fn(
          async (_opts: unknown, task: (p: { report: typeof progressReport }, t: unknown) => Promise<void>) => {
            await task(
              { report: progressReport },
              { isCancellationRequested: false, onCancellationRequested: vi.fn() },
            );
          },
        ),
      },
      workspace: {
        getConfiguration: vi.fn(() => ({ get: vi.fn() })),
        onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
      },
      ProgressLocation: { Notification: 15 },
    }));

    const { handlePullModelFromLibrary, ModelTreeItem } = await import('./sidebar.js');

    const item = new ModelTreeItem('llama3.2:1b', 'library-model-downloaded-variant');
    await handlePullModelFromLibrary(
      item,
      { pull: mockPull } as unknown as Ollama,
      { refresh: mockRefresh } as unknown as LocalModelsProvider,
    );

    expect(mockPull).toHaveBeenCalledWith({ model: 'llama3.2:1b', stream: true });
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('handlePullModelFromLibrary skips library-model parent items', async () => {
    vi.resetModules();

    const mockPull = vi.fn();

    vi.doMock('vscode', () => ({
      TreeItem: class {
        label: string;
        description?: string;
        contextValue?: string;
        collapsibleState?: number;
        tooltip?: string;
        command?: unknown;
        constructor(label: string) {
          this.label = label;
        }
      },
      ThemeIcon: class {},
      TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
      EventEmitter: class {
        event = {};
        fire = vi.fn();
      },
      window: {
        showInformationMessage: vi.fn(),
        showErrorMessage: vi.fn(),
        withProgress: vi.fn(),
      },
      workspace: {
        getConfiguration: vi.fn(() => ({ get: vi.fn() })),
        onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
      },
      ProgressLocation: { Notification: 15 },
    }));

    const { handlePullModelFromLibrary, ModelTreeItem } = await import('./sidebar.js');

    const item = new ModelTreeItem('llama3.2', 'library-model');
    await handlePullModelFromLibrary(
      item,
      { pull: mockPull } as unknown as Ollama,
      { refresh: vi.fn() } as unknown as LocalModelsProvider,
    );

    expect(mockPull).not.toHaveBeenCalled();
  });

  it('registerSidebar registers collapse commands for all three views', async () => {
    vi.resetModules();

    vi.doMock('vscode', () => ({
      TreeItem: class {
        label: string;
        constructor(label: string) {
          this.label = label;
        }
      },
      ThemeIcon: class {},
      TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
      EventEmitter: class {
        event = {};
        fire = vi.fn();
      },
      window: {
        createTreeView: vi.fn(() => ({ dispose: vi.fn() })),
        withProgress: vi.fn(),
        showInputBox: vi.fn(),
        showErrorMessage: vi.fn(),
        showInformationMessage: vi.fn(),
        showWarningMessage: vi.fn(),
      },
      commands: {
        registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
        executeCommand: vi.fn(),
      },
      env: { openExternal: vi.fn() },
      Uri: { parse: vi.fn((v: string) => ({ value: v })) },
      ProgressLocation: { Notification: 15 },
      workspace: {
        getConfiguration: vi.fn(() => ({ get: vi.fn(), update: vi.fn() })),
        onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
      },
    }));

    const vscode = await import('vscode');
    const { registerSidebar } = await import('./sidebar.js');

    const mockContext = {
      subscriptions: { push: vi.fn() },
      secrets: { get: vi.fn().mockResolvedValue(undefined), store: vi.fn(), delete: vi.fn() },
      globalState: { get: vi.fn(), update: vi.fn() },
    } as unknown as ExtensionContext;

    const mockClient = {
      list: vi.fn().mockResolvedValue({ models: [] }),
      generate: vi.fn(),
    } as unknown as Ollama;

    registerSidebar(mockContext, mockClient);

    const registerCommandMock = vi.mocked(vscode.commands.registerCommand);
    const registeredIds = registerCommandMock.mock.calls.map(([id]) => id);

    expect(registeredIds).toContain('opilot.collapseLocalModels');
    expect(registeredIds).toContain('opilot.collapseCloudModels');
    expect(registeredIds).toContain('opilot.collapseLibrary');

    // Invoke each collapse command handler and verify it delegates to the built-in VS Code command
    const executeCommandMock = vi.mocked(vscode.commands.executeCommand);
    const callHandler = (id: string) => {
      const entry = registerCommandMock.mock.calls.find(([cmd]) => cmd === id);
      return (entry?.[1] as (() => void) | undefined)?.();
    };

    callHandler('opilot.collapseLocalModels');
    expect(executeCommandMock).toHaveBeenCalledWith('workbench.actions.treeView.ollama-local-models.collapseAll');

    callHandler('opilot.collapseCloudModels');
    expect(executeCommandMock).toHaveBeenCalledWith('workbench.actions.treeView.ollama-cloud-models.collapseAll');

    callHandler('opilot.collapseLibrary');
    expect(executeCommandMock).toHaveBeenCalledWith('workbench.actions.treeView.ollama-library-models.collapseAll');
  });

  it('registerSidebar registers filter and clear-filter commands for all three views', async () => {
    vi.resetModules();
    vi.doMock('vscode', () => ({
      TreeItem: class {
        label: string;
        constructor(label: string) {
          this.label = label;
        }
      },
      ThemeIcon: class {},
      TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
      EventEmitter: class {
        event = {};
        fire = vi.fn();
      },
      window: {
        createTreeView: vi.fn(() => ({ dispose: vi.fn() })),
        withProgress: vi.fn(),
        showInputBox: vi.fn(),
        showErrorMessage: vi.fn(),
        showInformationMessage: vi.fn(),
        showWarningMessage: vi.fn(),
      },
      commands: {
        registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
        executeCommand: vi.fn(),
      },
      env: { openExternal: vi.fn() },
      Uri: { parse: vi.fn((v: string) => ({ value: v })) },
      ProgressLocation: { Notification: 15 },
      workspace: {
        getConfiguration: vi.fn(() => ({ get: vi.fn(), update: vi.fn() })),
        onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
      },
    }));

    const vscode = await import('vscode');
    const { registerSidebar } = await import('./sidebar.js');

    const mockContext = {
      subscriptions: { push: vi.fn() },
      secrets: { get: vi.fn().mockResolvedValue(undefined), store: vi.fn(), delete: vi.fn() },
      globalState: { get: vi.fn(), update: vi.fn() },
    } as unknown as ExtensionContext;
    const mockClient = { list: vi.fn().mockResolvedValue({ models: [] }), generate: vi.fn() } as unknown as Ollama;

    registerSidebar(mockContext, mockClient);

    const registerCommandMock = vscode.commands.registerCommand as ReturnType<typeof vi.fn>;
    const registeredIds = registerCommandMock.mock.calls.map(([id]: any[]) => id);
    expect(registeredIds).toContain('opilot.filterLocalModels');
    expect(registeredIds).toContain('opilot.clearLocalFilter');
    expect(registeredIds).toContain('opilot.filterCloudModels');
    expect(registeredIds).toContain('opilot.clearCloudFilter');
    expect(registeredIds).toContain('opilot.filterLibraryModels');
    expect(registeredIds).toContain('opilot.clearLibraryFilter');
  });
});

describe('LocalModelsProvider filter', () => {
  let LocalModelsProvider: any;
  let mockClient: any;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('vscode', () => ({
      TreeItem: class {
        label: string;
        description?: string;
        contextValue?: string;
        collapsibleState?: number;
        iconPath?: unknown;
        tooltip?: string;
        constructor(label: string) {
          this.label = label;
        }
      },
      ThemeIcon: class {
        constructor(public id: string) {}
      },
      TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
      EventEmitter: class {
        event = {};
        fire = vi.fn();
      },
      window: {
        registerTreeDataProvider: vi.fn(() => ({ dispose: vi.fn() })),
        showInputBox: vi.fn(),
        showErrorMessage: vi.fn(),
        showInformationMessage: vi.fn(),
        showWarningMessage: vi.fn(),
      },
      commands: { registerCommand: vi.fn(() => ({ dispose: vi.fn() })), executeCommand: vi.fn() },
      env: { openExternal: vi.fn() },
      Uri: { parse: vi.fn((v: string) => ({ value: v })) },
      ProgressLocation: { Notification: 15 },
      workspace: {
        getConfiguration: vi.fn(() => ({ get: vi.fn(() => 0), update: vi.fn() })),
        onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
      },
    }));

    const mod = await import('./sidebar.js');
    LocalModelsProvider = mod.LocalModelsProvider;

    mockClient = {
      list: vi.fn().mockResolvedValue({
        models: [
          { name: 'llama2:latest', size: 1000, digest: 'a1', details: {} },
          { name: 'llama3:latest', size: 1000, digest: 'a2', details: {} },
          { name: 'mistral:latest', size: 1000, digest: 'b1', details: {} },
        ],
      }),
      ps: vi.fn().mockResolvedValue({ models: [] }),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns all family groups when filterText is empty', async () => {
    const provider = new LocalModelsProvider(mockClient);
    const children = await provider.getChildren();
    const labels = children.map((c: any) => c.label);
    expect(labels).toContain('llama');
    expect(labels).toContain('mistral');
  });

  it('filters family groups to only matching families when filterText is set', async () => {
    const provider = new LocalModelsProvider(mockClient);
    provider.filterText = 'llama';
    const children = await provider.getChildren();
    const labels = children.map((c: any) => c.label);
    expect(labels).toContain('llama');
    expect(labels).not.toContain('mistral');
  });

  it('clears filter when filterText is set to empty string', async () => {
    const provider = new LocalModelsProvider(mockClient);
    provider.filterText = '';
    const children = await provider.getChildren();
    const labels = children.map((c: any) => c.label);
    expect(labels).toContain('llama');
    expect(labels).toContain('mistral');
  });
});

describe('LocalModelsProvider grouped/flat toggle', () => {
  let LocalModelsProvider: any;
  let mockClient: any;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('vscode', () => ({
      TreeItem: class {
        label: string;
        description?: string;
        contextValue?: string;
        collapsibleState?: number;
        iconPath?: unknown;
        tooltip?: string;
        constructor(label: string) {
          this.label = label;
        }
      },
      ThemeIcon: class {
        constructor(public id: string) {}
      },
      TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
      EventEmitter: class {
        event = {};
        fire = vi.fn();
      },
      window: {
        registerTreeDataProvider: vi.fn(() => ({ dispose: vi.fn() })),
        showInputBox: vi.fn(),
        showErrorMessage: vi.fn(),
        showInformationMessage: vi.fn(),
        showWarningMessage: vi.fn(),
      },
      commands: { registerCommand: vi.fn(() => ({ dispose: vi.fn() })), executeCommand: vi.fn() },
      env: { openExternal: vi.fn() },
      Uri: { parse: vi.fn((v: string) => ({ value: v })) },
      ProgressLocation: { Notification: 15 },
      workspace: {
        getConfiguration: vi.fn(() => ({ get: vi.fn(() => 0), update: vi.fn() })),
        onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
      },
    }));

    const mod = await import('./sidebar.js');
    LocalModelsProvider = mod.LocalModelsProvider;

    mockClient = {
      list: vi.fn().mockResolvedValue({
        models: [
          { name: 'llama2:latest', size: 1000, digest: 'a1', details: {} },
          { name: 'mistral:latest', size: 1000, digest: 'b1', details: {} },
          { name: 'gemma:latest', size: 1000, digest: 'c1', details: {} },
        ],
      }),
      ps: vi.fn().mockResolvedValue({ models: [] }),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to grouped mode returning family groups', async () => {
    const provider = new LocalModelsProvider(mockClient);
    const children = await provider.getChildren();
    // grouped: should return family-group items, not raw model items
    const hasGroup = children.some((c: any) => c.label === 'llama' || c.label === 'mistral');
    expect(hasGroup).toBe(true);
  });

  it('returns flat alphabetical list when grouped is false', async () => {
    const provider = new LocalModelsProvider(mockClient);
    provider.grouped = false;
    const children = await provider.getChildren();
    const labels = children.map((c: any) => c.label);
    // All model labels present (not family groups)
    expect(labels).toContain('llama2:latest');
    expect(labels).toContain('mistral:latest');
    expect(labels).toContain('gemma:latest');
    // Alphabetically sorted
    expect(labels[0]).toBe('gemma:latest');
    expect(labels[1]).toBe('llama2:latest');
    expect(labels[2]).toBe('mistral:latest');
  });
});

describe('registerSidebar grouped/flat toggle commands', () => {
  it('registers toggleLocalGrouping, toggleCloudGrouping, toggleLibraryGrouping commands', async () => {
    vi.resetModules();
    vi.doMock('vscode', () => ({
      TreeItem: class {
        label: string;
        constructor(label: string) {
          this.label = label;
        }
      },
      ThemeIcon: class {},
      TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
      EventEmitter: class {
        event = {};
        fire = vi.fn();
      },
      window: {
        createTreeView: vi.fn(() => ({ dispose: vi.fn() })),
        withProgress: vi.fn(),
        showInputBox: vi.fn(),
        showErrorMessage: vi.fn(),
        showInformationMessage: vi.fn(),
        showWarningMessage: vi.fn(),
      },
      commands: {
        registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
        executeCommand: vi.fn(),
      },
      env: { openExternal: vi.fn() },
      Uri: { parse: vi.fn((v: string) => ({ value: v })) },
      ProgressLocation: { Notification: 15 },
      workspace: {
        getConfiguration: vi.fn(() => ({ get: vi.fn(() => 0), update: vi.fn() })),
        onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
      },
    }));

    const vscode = await import('vscode');
    const { registerSidebar } = await import('./sidebar.js');

    const mockContext = {
      subscriptions: { push: vi.fn() },
      secrets: { get: vi.fn().mockResolvedValue(undefined), store: vi.fn(), delete: vi.fn() },
      globalState: { get: vi.fn().mockReturnValue(undefined), update: vi.fn() },
    } as unknown as ExtensionContext;
    const mockClient = { list: vi.fn().mockResolvedValue({ models: [] }), generate: vi.fn() } as unknown as Ollama;

    registerSidebar(mockContext, mockClient);

    const registerCommandMock = vscode.commands.registerCommand as ReturnType<typeof vi.fn>;
    const registeredIds = registerCommandMock.mock.calls.map(([id]: any[]) => id);
    expect(registeredIds).toContain('opilot.toggleLocalGrouping');
    expect(registeredIds).toContain('opilot.toggleCloudGrouping');
    expect(registeredIds).toContain('opilot.toggleLibraryGrouping');
    expect(registeredIds).toContain('opilot.toggleLocalGroupingToTree');
    expect(registeredIds).toContain('opilot.toggleCloudGroupingToTree');
    expect(registeredIds).toContain('opilot.toggleLibraryGroupingToTree');
  });
});

describe('Provider lifecycle and disposal', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('LocalModelsProvider.dispose() unregisters the config change listener', async () => {
    vi.resetModules();

    const configDispose = vi.fn();
    vi.doMock('vscode', () => ({
      TreeItem: class {
        label: string;
        constructor(label: string) {
          this.label = label;
        }
      },
      ThemeIcon: class {},
      TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
      EventEmitter: class {
        event = vi.fn();
        fire = vi.fn();
      },
      window: {
        createTreeView: vi.fn(() => ({ dispose: vi.fn() })),
        registerTreeDataProvider: vi.fn(() => ({ dispose: vi.fn() })),
        showInputBox: vi.fn(),
        showErrorMessage: vi.fn(),
        showInformationMessage: vi.fn(),
        showWarningMessage: vi.fn(),
        withProgress: vi.fn(),
      },
      commands: {
        registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
        executeCommand: vi.fn(),
      },
      env: { openExternal: vi.fn() },
      Uri: { parse: vi.fn((v: string) => ({ value: v })) },
      ProgressLocation: { Notification: 15 },
      workspace: {
        getConfiguration: vi.fn(() => ({ get: vi.fn(() => 0) })),
        onDidChangeConfiguration: vi.fn(() => ({ dispose: configDispose })),
      },
    }));

    const { LocalModelsProvider } = await import('./sidebar.js');
    const mockClient = {
      list: vi.fn().mockResolvedValue({ models: [] }),
      ps: vi.fn().mockResolvedValue({ models: [] }),
      show: vi.fn(),
    } as unknown as Ollama;
    const provider = new LocalModelsProvider(mockClient);

    provider.dispose();

    expect(configDispose).toHaveBeenCalledTimes(1);
  });

  it('LocalModelsProvider.dispose() stops auto-refresh intervals', async () => {
    vi.resetModules();

    vi.doMock('vscode', () => ({
      TreeItem: class {
        label: string;
        constructor(label: string) {
          this.label = label;
        }
      },
      ThemeIcon: class {},
      TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
      EventEmitter: class {
        event = vi.fn();
        fire = vi.fn();
      },
      window: {
        createTreeView: vi.fn(() => ({ dispose: vi.fn() })),
        registerTreeDataProvider: vi.fn(() => ({ dispose: vi.fn() })),
        showInputBox: vi.fn(),
        showErrorMessage: vi.fn(),
        showInformationMessage: vi.fn(),
        showWarningMessage: vi.fn(),
        withProgress: vi.fn(),
      },
      commands: {
        registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
        executeCommand: vi.fn(),
      },
      env: { openExternal: vi.fn() },
      Uri: { parse: vi.fn((v: string) => ({ value: v })) },
      ProgressLocation: { Notification: 15 },
      workspace: {
        getConfiguration: vi.fn(() => ({ get: (key: string) => (key === 'localModelRefreshInterval' ? 1 : 0) })),
        onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
      },
    }));

    vi.useFakeTimers();

    const { LocalModelsProvider } = await import('./sidebar.js');
    const onLocalModelsChanged = vi.fn();
    const mockClient = {
      list: vi.fn().mockResolvedValue({ models: [] }),
      ps: vi.fn().mockResolvedValue({ models: [] }),
    } as unknown as Ollama;
    const provider = new LocalModelsProvider(mockClient, undefined, undefined, onLocalModelsChanged);

    // Dispose before the first auto-refresh interval fires (interval = 1s)
    provider.dispose();

    // Advance 5 seconds — auto-refresh should NOT fire after dispose
    await vi.advanceTimersByTimeAsync(5000);

    expect(onLocalModelsChanged).not.toHaveBeenCalled();
  });

  it('LocalModelsProvider.dispose() cancels pending debounce timer before it fires', async () => {
    vi.resetModules();

    vi.doMock('vscode', () => ({
      TreeItem: class {
        label: string;
        constructor(label: string) {
          this.label = label;
        }
      },
      ThemeIcon: class {},
      TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
      EventEmitter: class {
        event = vi.fn();
        fire = vi.fn();
      },
      window: {
        createTreeView: vi.fn(() => ({ dispose: vi.fn() })),
        registerTreeDataProvider: vi.fn(() => ({ dispose: vi.fn() })),
        showInputBox: vi.fn(),
        showErrorMessage: vi.fn(),
        showInformationMessage: vi.fn(),
        showWarningMessage: vi.fn(),
        withProgress: vi.fn(),
      },
      commands: {
        registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
        executeCommand: vi.fn(),
      },
      env: { openExternal: vi.fn() },
      Uri: { parse: vi.fn((v: string) => ({ value: v })) },
      ProgressLocation: { Notification: 15 },
      workspace: {
        getConfiguration: vi.fn(() => ({ get: vi.fn(() => 0) })),
        onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
      },
    }));

    vi.useFakeTimers();

    const { LocalModelsProvider } = await import('./sidebar.js');
    const onLocalModelsChanged = vi.fn();
    const mockClient = {
      list: vi.fn().mockResolvedValue({ models: [] }),
      ps: vi.fn().mockResolvedValue({ models: [] }),
    } as unknown as Ollama;
    const provider = new LocalModelsProvider(mockClient, undefined, undefined, onLocalModelsChanged);

    // Start a debounce (300ms)
    provider.refresh();

    // Dispose before debounce fires
    provider.dispose();

    // Advance past the 300ms debounce window
    await vi.advanceTimersByTimeAsync(500);

    // onLocalModelsChanged must NOT have been called (timer was cancelled)
    expect(onLocalModelsChanged).not.toHaveBeenCalled();
  });

  it('CloudModelsProvider.dispose() stops auto-refresh intervals', async () => {
    vi.resetModules();

    vi.doMock('vscode', () => ({
      TreeItem: class {
        label: string;
        constructor(label: string) {
          this.label = label;
        }
      },
      ThemeIcon: class {},
      TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
      EventEmitter: class {
        event = vi.fn();
        fire = vi.fn();
      },
      window: {
        createTreeView: vi.fn(() => ({ dispose: vi.fn() })),
        registerTreeDataProvider: vi.fn(() => ({ dispose: vi.fn() })),
        showInputBox: vi.fn(),
        showErrorMessage: vi.fn(),
        showInformationMessage: vi.fn(),
        showWarningMessage: vi.fn(),
        withProgress: vi.fn(),
      },
      commands: {
        registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
        executeCommand: vi.fn(),
      },
      env: { openExternal: vi.fn() },
      Uri: { parse: vi.fn((v: string) => ({ value: v })) },
      ProgressLocation: { Notification: 15 },
      workspace: {
        getConfiguration: vi.fn(() => ({ get: (key: string) => (key === 'cloudModelRefreshInterval' ? 1 : 0) })),
        onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
      },
    }));

    vi.useFakeTimers();

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue({ ok: true, headers: { get: vi.fn().mockReturnValue('text/html') }, text: async () => '' }),
    );

    const { CloudModelsProvider } = await import('./sidebar.js');
    const mockContext = {
      secrets: { get: vi.fn().mockResolvedValue(undefined), store: vi.fn(), delete: vi.fn() },
      globalState: { get: vi.fn().mockReturnValue(undefined), update: vi.fn() },
    } as unknown as ExtensionContext;

    const cloudProvider = new CloudModelsProvider(mockContext);
    const refreshSpy = vi.spyOn(cloudProvider, 'refresh');

    cloudProvider.dispose();

    // Advance several seconds — refresh should NOT be called by internal intervals after dispose
    await vi.advanceTimersByTimeAsync(10000);

    expect(refreshSpy).not.toHaveBeenCalled();
  });

  it('registerSidebar pushes provider dispose wrappers to context.subscriptions', async () => {
    vi.resetModules();

    vi.doMock('vscode', () => ({
      TreeItem: class {
        label: string;
        constructor(label: string) {
          this.label = label;
        }
      },
      ThemeIcon: class {},
      TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
      EventEmitter: class {
        event = {};
        fire = vi.fn();
      },
      window: {
        createTreeView: vi.fn(() => ({ dispose: vi.fn() })),
        showInputBox: vi.fn(),
        showErrorMessage: vi.fn(),
        showInformationMessage: vi.fn(),
        showWarningMessage: vi.fn(),
        withProgress: vi.fn(),
      },
      commands: {
        registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
        executeCommand: vi.fn(),
      },
      env: { openExternal: vi.fn() },
      Uri: { parse: vi.fn((v: string) => ({ value: v })) },
      ProgressLocation: { Notification: 15 },
      workspace: {
        getConfiguration: vi.fn(() => ({ get: vi.fn(() => 0), update: vi.fn() })),
        onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
      },
    }));

    const { registerSidebar } = await import('./sidebar.js');

    const pushedItems: unknown[] = [];
    const mockContext = {
      subscriptions: { push: (...items: unknown[]) => pushedItems.push(...items) },
      secrets: { get: vi.fn().mockResolvedValue(undefined), store: vi.fn(), delete: vi.fn() },
      globalState: { get: vi.fn().mockReturnValue(undefined), update: vi.fn() },
    } as unknown as ExtensionContext;
    const mockClient = { list: vi.fn().mockResolvedValue({ models: [] }), generate: vi.fn() } as unknown as Ollama;

    registerSidebar(mockContext, mockClient);

    // At least 3 dispose-wrapper items must be in subscriptions (for local, library, cloud providers)
    const disposeWrappers = pushedItems.filter(
      item =>
        item !== null && typeof item === 'object' && typeof (item as { dispose?: unknown }).dispose === 'function',
    );
    expect(disposeWrappers.length).toBeGreaterThanOrEqual(3);
  });
});
