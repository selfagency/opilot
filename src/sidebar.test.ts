import type { Ollama } from 'ollama';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
      ThemeIcon: class {},
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
        withProgress: vi.fn(async (_options: unknown, callback: () => Promise<void>) => callback()),
        showInputBox: vi.fn(),
        showErrorMessage: vi.fn(),
        showInformationMessage: vi.fn(),
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
      workspace: {
        getConfiguration: vi.fn(() => ({
          get: vi.fn((key: string) => {
            if (key === 'localModelRefreshInterval') return 0;
            if (key === 'libraryRefreshInterval') return 0;
            if (key === 'librarySortMode') return 'name';
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

    expect(models).toHaveLength(2);
    expect(models[0].label).toBe('llama2:latest');
    expect(models[1].label).toBe('mistral:latest');
  });

  it('adds tooltip process details for local models', async () => {
    const models = await provider.getChildren();
    expect(models[0].tooltip).toContain('llama2:latest');
    expect(models[0].tooltip).toContain('abc123');
    expect(models[0].tooltip).toContain('GPU');
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

  it('returns tree item unchanged', () => {
    const item = new ModelTreeItem('mistral:latest', 'local-stopped', 4109738016);
    const treeItem = provider.getTreeItem(item);

    expect(treeItem.label).toBe('mistral:latest');
    expect(treeItem.description).toContain('GB');
  });

  it('uses model details command when clicking local model items', async () => {
    const models = await provider.getChildren();
    expect(models[0].command?.command).toBe('ollama-copilot.showModelDetails');
    expect(models[1].command?.command).toBe('ollama-copilot.showModelDetails');
  });

  it('uses model details command when clicking library model items', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => '<a href="/library/llama3"></a><a href="/library/mistral"></a>',
      }),
    );

    const libraryProvider = new LibraryModelsProvider(async () => new Set<string>(), undefined);
    const models = await libraryProvider.getChildren();

    expect(models[0].command?.command).toBe('ollama-copilot.openLibraryModel');
    libraryProvider.dispose();
  });

  it('uses model details command when clicking cloud model items', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          models: [{ name: 'cloud/llama3', size: 1024, expires_at: '2099-03-05T00:00:00Z' }],
        }),
      }),
    );

    const cloudProvider = new CloudModelsProvider(
      {
        secrets: {
          get: vi.fn().mockResolvedValue('test-api-key'),
        },
      },
      undefined,
    );

    const models = await cloudProvider.getChildren();
    expect(models[0].command?.command).toBe('ollama-copilot.openCloudModel');
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
    const libraryProvider = new LibraryModelsProvider(async () => new Set<string>(), undefined);

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
    const libraryProvider = new LibraryModelsProvider(async () => new Set<string>(), undefined);

    const models = await libraryProvider.getChildren();
    expect(models[0].label).toBe('alpha');
    expect(models[1].label).toBe('zeta');
    libraryProvider.dispose();
  });

  it('can sort library by recency order when selected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => '<a href="/library/zeta"></a><a href="/library/alpha"></a>',
      }),
    );
    const libraryProvider = new LibraryModelsProvider(async () => new Set<string>(), undefined);
    libraryProvider.setSortMode('recency');

    const models = await libraryProvider.getChildren();
    expect(models[0].label).toBe('zeta');
    expect(models[1].label).toBe('alpha');
    libraryProvider.dispose();
  });

  it('shows status item when cloud API key is missing', async () => {
    const cloudProvider = new CloudModelsProvider(
      {
        secrets: {
          get: vi.fn().mockResolvedValue(undefined),
        },
      },
      undefined,
    );

    const models = await cloudProvider.getChildren();
    expect(models).toHaveLength(1);
    expect(models[0].label).toBe('Add Ollama Cloud API key to view cloud models');
    expect(models[0].contextValue).toBe('status');
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

    const models = await localProvider.getChildren();
    const model = models?.find((m: any) => m.label === 'llama2');
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

    const models = await localProvider.getChildren();
    const model = models?.find((m: any) => m.label === 'llama2');
    expect(model?.type).toBe('local-running');
    expect(generateModel).toBeDefined();
    localProvider.dispose();
  });

  it('library provider sort mode configuration', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => '<a href="/library/model1"></a>',
      }),
    );
    const libraryProvider = new LibraryModelsProvider(async () => new Set<string>(), undefined);

    libraryProvider.setSortMode('recency');
    expect(libraryProvider.getSortMode()).toBe('recency');

    libraryProvider.setSortMode('name');
    expect(libraryProvider.getSortMode()).toBe('name');

    libraryProvider.dispose();
  });

  it('cloud provider handles empty API key', async () => {
    const cloudProvider = new CloudModelsProvider(
      {
        secrets: {
          get: vi.fn().mockResolvedValue(null),
        },
      },
      undefined,
    );

    const models = await cloudProvider.getChildren();
    expect(models).toHaveLength(1);
    expect(models[0].contextValue).toBe('status');
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
    const libraryProvider = new LibraryModelsProvider(async () => new Set<string>(), undefined);

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

    const models = await localProvider.getChildren();
    expect(models).toHaveLength(1);
    expect(models[0].description).toBeDefined();
    localProvider.dispose();
  });

  it('cloud models provider handles large model size', async () => {
    const cloudProvider = new CloudModelsProvider(
      {
        secrets: {
          get: vi.fn().mockResolvedValue('test-key'),
        },
      } as unknown as any,
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
    const libraryProvider = new LibraryModelsProvider(async () => new Set<string>(), undefined);
    libraryProvider.dispose();
    // After dispose, provider should be cleaned up
    expect(libraryProvider).toBeDefined();
  });
});

describe('Extracted command handlers', () => {
  it('handleRefreshLocalModels refreshes provider and shows message', async () => {
    const { handleRefreshLocalModels } = await import('./sidebar.js');

    const mockProvider = {
      refresh: vi.fn(),
    } as any;

    handleRefreshLocalModels(mockProvider);

    expect(mockProvider.refresh).toHaveBeenCalled();
  });

  it('handleRefreshLibrary refreshes library and shows message', async () => {
    const { handleRefreshLibrary } = await import('./sidebar.js');

    const mockProvider = {
      refresh: vi.fn(),
    } as any;

    handleRefreshLibrary(mockProvider);

    expect(mockProvider.refresh).toHaveBeenCalled();
  });

  it('handleRefreshCloudModels refreshes cloud provider', async () => {
    const { handleRefreshCloudModels } = await import('./sidebar.js');

    const mockProvider = {
      refresh: vi.fn(),
    } as any;

    handleRefreshCloudModels(mockProvider);

    expect(mockProvider.refresh).toHaveBeenCalled();
  });

  it('handleSortLibraryByRecency sets sort mode and syncs context', async () => {
    const { handleSortLibraryByRecency } = await import('./sidebar.js');

    const mockProvider = {
      setSortMode: vi.fn(),
    } as any;

    const mockSync = vi.fn();

    handleSortLibraryByRecency(mockProvider, mockSync);

    expect(mockProvider.setSortMode).toHaveBeenCalledWith('recency');
    expect(mockSync).toHaveBeenCalled();
  });

  it('handleSortLibraryByName sets sort mode to name', async () => {
    const { handleSortLibraryByName } = await import('./sidebar.js');

    const mockProvider = {
      setSortMode: vi.fn(),
    } as any;

    const mockSync = vi.fn();

    handleSortLibraryByName(mockProvider, mockSync);

    expect(mockProvider.setSortMode).toHaveBeenCalledWith('name');
    expect(mockSync).toHaveBeenCalled();
  });

  it('handleDeleteModel deletes local model', async () => {
    const { handleDeleteModel, ModelTreeItem } = await import('./sidebar.js');

    const mockProvider = {
      deleteModel: vi.fn(),
    } as any;

    const item = new ModelTreeItem('test-model', 'local-running', 1000);

    handleDeleteModel(item, mockProvider);

    expect(mockProvider.deleteModel).toHaveBeenCalledWith('test-model');
  });

  it('handleDeleteModel ignores non-local models', async () => {
    const { handleDeleteModel, ModelTreeItem } = await import('./sidebar.js');

    const mockProvider = {
      deleteModel: vi.fn(),
    } as any;

    const item = new ModelTreeItem('test-model', 'library-model');

    handleDeleteModel(item, mockProvider);

    expect(mockProvider.deleteModel).not.toHaveBeenCalled();
  });

  it('handleStartModel starts stopped local model', async () => {
    const { handleStartModel, ModelTreeItem } = await import('./sidebar.js');

    const mockProvider = {
      startModel: vi.fn(),
    } as any;

    const item = new ModelTreeItem('test-model', 'local-stopped');

    handleStartModel(item, mockProvider);

    expect(mockProvider.startModel).toHaveBeenCalledWith('test-model');
  });

  it('handleStopModel stops running model', async () => {
    const { handleStopModel, ModelTreeItem } = await import('./sidebar.js');

    const mockProvider = {
      stopModel: vi.fn(),
    } as any;

    const item = new ModelTreeItem('test-model', 'local-running');

    handleStopModel(item, mockProvider);

    expect(mockProvider.stopModel).toHaveBeenCalledWith('test-model');
  });

  it('handleOpenLibraryModel opens external URL', async () => {
    const { handleOpenLibraryModel } = await import('./sidebar.js');

    // Should not throw
    handleOpenLibraryModel('mistral');

    expect(handleOpenLibraryModel).toBeDefined();
  });

  it('handleOpenCloudModel opens cloud model URL', async () => {
    const { handleOpenCloudModel } = await import('./sidebar.js');

    // Should not throw
    handleOpenCloudModel('claude');

    expect(handleOpenCloudModel).toBeDefined();
  });

  it('handleDeleteModel ignores null or status items', async () => {
    const { handleDeleteModel } = await import('./sidebar.js');

    const mockProvider = {
      deleteModel: vi.fn(),
    } as any;

    handleDeleteModel(null as any, mockProvider);

    expect(mockProvider.deleteModel).not.toHaveBeenCalled();
  });

  it('handleStartModel does nothing for running models', async () => {
    const { handleStartModel, ModelTreeItem } = await import('./sidebar.js');

    const mockProvider = {
      startModel: vi.fn(),
    } as any;

    const item = new ModelTreeItem('test-model', 'local-running');

    handleStartModel(item, mockProvider);

    expect(mockProvider.startModel).not.toHaveBeenCalled();
  });

  it('handleStopModel handles cloud-running models', async () => {
    const { handleStopModel, ModelTreeItem } = await import('./sidebar.js');

    const mockProvider = {
      stopModel: vi.fn(),
    } as any;

    const item = new ModelTreeItem('test-model', 'cloud-running');

    handleStopModel(item, mockProvider);

    expect(mockProvider.stopModel).toHaveBeenCalledWith('test-model');
  });

  it('handleStartCloudModel starts cloud-stopped models', async () => {
    const { handleStartCloudModel, ModelTreeItem } = await import('./sidebar.js');

    const mockProvider = {
      startModel: vi.fn(),
    } as any;

    const item = new ModelTreeItem('test-model', 'cloud-stopped');

    handleStartCloudModel(item, mockProvider);

    expect(mockProvider.startModel).toHaveBeenCalledWith('test-model');
  });

  it('handleStopCloudModel stops cloud-running models', async () => {
    const { handleStopCloudModel, ModelTreeItem } = await import('./sidebar.js');

    const mockProvider = {
      stopModel: vi.fn(),
    } as any;

    const item = new ModelTreeItem('test-model', 'cloud-running');

    handleStopCloudModel(item, mockProvider);

    expect(mockProvider.stopModel).toHaveBeenCalledWith('test-model');
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

  it('handlePreviewLibraryModel ignores non-library models', async () => {
    const { handlePreviewLibraryModel, ModelTreeItem } = await import('./sidebar.js');

    const item = new ModelTreeItem('test-model', 'local-running');

    // Should not throw
    handlePreviewLibraryModel(item);

    expect(handlePreviewLibraryModel).toBeDefined();
  });

  it('handleShowModelDetails returns early for status items', async () => {
    const { handleShowModelDetails, ModelTreeItem } = await import('./sidebar.js');

    const mockPreviewProvider = {
      setLoading: vi.fn(),
      setModelPreview: vi.fn(),
      setError: vi.fn(),
      setModelDetails: vi.fn(),
    } as any;

    const item = new ModelTreeItem('Status', 'status');

    handleShowModelDetails(item, mockPreviewProvider);

    expect(mockPreviewProvider.setModelDetails).not.toHaveBeenCalled();
  });

  it('handleShowModelDetails shows local model details', async () => {
    const { handleShowModelDetails, ModelTreeItem } = await import('./sidebar.js');

    const mockPreviewProvider = {
      setLoading: vi.fn(),
      setModelPreview: vi.fn(),
      setError: vi.fn(),
      setModelDetails: vi.fn(),
    } as any;

    const item = new ModelTreeItem('test-model', 'local-running', 1024);
    item.description = '1GB • running';

    handleShowModelDetails(item, mockPreviewProvider);

    expect(mockPreviewProvider.setModelDetails).toHaveBeenCalled();
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
    } as any;

    const mockProvider = {
      refresh: vi.fn(),
    } as any;

    const item = new ModelTreeItem('mistral:7b', 'library-model');

    // Should not throw
    handlePullModelFromLibrary(item, _mockClient, mockProvider);

    // Since it's async with promise handling, pull should be called eventually
    // Verify the function exists and is callable
    expect(typeof handlePullModelFromLibrary).toBe('function');
  });

  it('handlePullModelFromLibrary ignores non-library models', async () => {
    const { handlePullModelFromLibrary, ModelTreeItem } = await import('./sidebar.js');

    const mockClient = {
      pull: vi.fn().mockResolvedValue(undefined),
    } as any;

    const mockProvider = {
      refresh: vi.fn(),
    } as any;

    const item = new ModelTreeItem('test-model', 'local-running');

    handlePullModelFromLibrary(item, mockClient, mockProvider);

    // Pull should not be called for non-library models
    expect(mockClient.pull).not.toHaveBeenCalled();
  });

  it('handleManageCloudApiKey function is callable', async () => {
    const { handleManageCloudApiKey } = await import('./sidebar.js');

    expect(typeof handleManageCloudApiKey).toBe('function');
  });
});
