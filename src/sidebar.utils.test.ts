import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.doMock('vscode', () => ({
    TreeItem: class {
      label: string;
      description?: string;
      contextValue?: string;
      collapsibleState?: number;
      iconPath?: unknown;
      tooltip?: string;
      command?: unknown;

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
      showInformationMessage: vi.fn(),
      showWarningMessage: vi.fn(),
      showErrorMessage: vi.fn(),
      createTreeView: vi.fn(() => ({ dispose: vi.fn() })),
      withProgress: vi.fn(async (_opts: unknown, cb: (progress: unknown, token: unknown) => Promise<void>) =>
        cb({}, {}),
      ),
      createTerminal: vi.fn(() => ({ show: vi.fn(), sendText: vi.fn() })),
      showInputBox: vi.fn(),
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
      getConfiguration: vi.fn(() => ({ get: vi.fn(() => 0), update: vi.fn() })),
      onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
    },
    Disposable: class {},
  }));
});

describe('sidebar utility helpers', () => {
  it('assertHtmlContentType accepts missing or text/html headers and rejects non-html', async () => {
    const { assertHtmlContentType } = await import('./sidebar.js');

    expect(() =>
      assertHtmlContentType({
        headers: { get: () => null },
        url: 'https://ollama.com/library',
        status: 200,
      } as unknown as Response),
    ).not.toThrow();

    expect(() =>
      assertHtmlContentType({
        headers: { get: () => 'text/html; charset=utf-8' },
        url: 'https://ollama.com/library',
        status: 200,
      } as unknown as Response),
    ).not.toThrow();

    expect(() =>
      assertHtmlContentType({
        headers: { get: () => 'application/json' },
        url: 'https://ollama.com/library',
        status: 502,
      } as unknown as Response),
    ).toThrow("Expected text/html from https://ollama.com/library but got 'application/json' (HTTP 502)");
  });

  it('extractModelFamily handles exception, dashed, numeric and embedded-version names', async () => {
    const { extractModelFamily } = await import('./sidebar.js');

    expect(extractModelFamily('gpt-oss-20b:latest')).toBe('gpt-oss');
    expect(extractModelFamily('open-orca-small:latest')).toBe('open-orca');
    expect(extractModelFamily('command-r:latest')).toBe('command');
    expect(extractModelFamily('phi3.5:latest')).toBe('phi');
    expect(extractModelFamily('qwen2.5vl:latest')).toBe('qwen');
    expect(extractModelFamily('r1-large:latest')).toBe('r1');
    expect(extractModelFamily('mistral:latest')).toBe('mistral');
  });

  it('groupModelsByFamily groups by extracted family', async () => {
    const { ModelTreeItem, groupModelsByFamily } = await import('./sidebar.js');

    const models = [
      new ModelTreeItem('llama3.2:latest', 'local-stopped'),
      new ModelTreeItem('llama2:latest', 'local-stopped'),
      new ModelTreeItem('mistral:latest', 'local-stopped'),
    ];

    const grouped = groupModelsByFamily(models);
    expect(grouped.get('llama')?.length).toBe(2);
    expect(grouped.get('mistral')?.length).toBe(1);
  });

  it('aggregateFamilyCapabilities and buildCapabilityLines combine badges', async () => {
    const { ModelTreeItem, aggregateFamilyCapabilities, buildCapabilityLines } = await import('./sidebar.js');

    const a = new ModelTreeItem('a', 'local-stopped');
    a.description = 'size 🧠 🛠️';
    const b = new ModelTreeItem('b', 'local-stopped');
    b.description = '👁️';
    const c = new ModelTreeItem('c', 'local-stopped');
    c.description = '🧩';

    const caps = aggregateFamilyCapabilities([a, b, c]);
    expect(caps).toEqual({ thinking: true, tools: true, vision: true, embedding: true });

    expect(buildCapabilityLines(caps)).toContain('🧠 Thinking');
    expect(buildCapabilityLines({})).toBe('');
  });

  it('formatRelativeFromNow and formatSizeForTooltip cover edge branches', async () => {
    const { formatRelativeFromNow, formatSizeForTooltip } = await import('./sidebar.js');

    expect(formatRelativeFromNow(undefined)).toBe('Not running');
    expect(formatRelativeFromNow(0)).toBe('now');
    expect(formatRelativeFromNow(1500)).toBe('1 second from now');
    expect(formatRelativeFromNow(65_000)).toBe('1 minute from now');
    expect(formatRelativeFromNow(2 * 60 * 60 * 1000)).toBe('2 hours from now');

    expect(formatSizeForTooltip(undefined)).toBe('Unknown');
    expect(formatSizeForTooltip(1024 ** 3)).toBe('1.0 GB');
  });

  it('buildLocalModelTooltip includes capability line and running details', async () => {
    const { buildLocalModelTooltip } = await import('./sidebar.js');

    const tooltip = buildLocalModelTooltip(
      'llama3.2:latest',
      3 * 1024 ** 3,
      { id: 'abc', durationMs: 90_000, processor: '25% GPU', size: 3 * 1024 ** 3, sizeVram: 1 * 1024 ** 3 },
      'description',
      { thinking: true, toolCalling: true, imageInput: false, embedding: true },
    );

    expect(tooltip).toContain('🆔 abc');
    expect(tooltip).toContain('CPU: 75% | GPU: 25%');
    expect(tooltip).toContain('🧠 Thinking');
    expect(tooltip).toContain('description');
  });

  it('getLibraryModelUrl safely encodes path segments', async () => {
    const { getLibraryModelUrl } = await import('./sidebar.js');
    expect(getLibraryModelUrl('org/model name')).toBe('https://ollama.com/library/org/model%20name');
    expect(getLibraryModelUrl('../bad')).toBe('https://ollama.com/library/%2E%2E/bad');
  });

  describe('extractParamsBillions', () => {
    it('parses colon-separated size tags', async () => {
      const { extractParamsBillions } = await import('./sidebar.js');
      expect(extractParamsBillions('llama3.2:3b')).toBe(3);
      expect(extractParamsBillions('qwen2.5:72b')).toBe(72);
      expect(extractParamsBillions('mistral:7b-instruct')).toBe(7);
    });

    it('parses dash-separated size tokens', async () => {
      const { extractParamsBillions } = await import('./sidebar.js');
      expect(extractParamsBillions('llama-7b')).toBe(7);
      expect(extractParamsBillions('model-3b-instruct')).toBe(3);
    });

    it('parses underscore-separated size tokens', async () => {
      const { extractParamsBillions } = await import('./sidebar.js');
      expect(extractParamsBillions('model_72b')).toBe(72);
    });

    it('parses decimal parameter counts', async () => {
      const { extractParamsBillions } = await import('./sidebar.js');
      expect(extractParamsBillions('phi4:3.8b')).toBe(3.8);
      expect(extractParamsBillions('gemma:0.6b')).toBe(0.6);
    });

    it('is case-insensitive for the B suffix', async () => {
      const { extractParamsBillions } = await import('./sidebar.js');
      expect(extractParamsBillions('model:7B')).toBe(7);
    });

    it('returns null when no size token is present', async () => {
      const { extractParamsBillions } = await import('./sidebar.js');
      expect(extractParamsBillions('phi4')).toBeNull();
      expect(extractParamsBillions('llama3.2:latest')).toBeNull();
      expect(extractParamsBillions('')).toBeNull();
    });
  });

  describe('isRecommendedForHardware', () => {
    it('returns false when parameter count cannot be determined', async () => {
      vi.doMock('node:os', () => ({ totalmem: () => 32 * 1024 ** 3 }));
      const { isRecommendedForHardware } = await import('./sidebar.js');
      expect(isRecommendedForHardware('phi4')).toBe(false);
      expect(isRecommendedForHardware('llama3.2:latest')).toBe(false);
    });

    it('recommends small models when enough RAM is available', async () => {
      // 32 GB total → available = 30 GB → threshold = 18 GB
      // 3B model: memGB = 3 * 2 * 0.5 = 3 GB → fits
      // 7B model: memGB = 7 * 2 * 0.5 = 7 GB → fits
      vi.doMock('node:os', () => ({ totalmem: () => 32 * 1024 ** 3 }));
      const { isRecommendedForHardware } = await import('./sidebar.js');
      expect(isRecommendedForHardware('llama3.2:3b')).toBe(true);
      expect(isRecommendedForHardware('mistral:7b')).toBe(true);
    });

    it('does not recommend large models that exceed the headroom threshold', async () => {
      // 8 GB total → available = 6 GB → threshold = 3.6 GB
      // 7B model: memGB = 7 * 2 * 0.5 = 7 GB → does not fit
      vi.doMock('node:os', () => ({ totalmem: () => 8 * 1024 ** 3 }));
      const { isRecommendedForHardware } = await import('./sidebar.js');
      expect(isRecommendedForHardware('mistral:7b')).toBe(false);
    });

    it('recommends models that just fit within the 60% threshold', async () => {
      // 16 GB total → available = 14 GB → threshold = 8.4 GB
      // 3B model: memGB = 3 GB → fits comfortably
      vi.doMock('node:os', () => ({ totalmem: () => 16 * 1024 ** 3 }));
      const { isRecommendedForHardware } = await import('./sidebar.js');
      expect(isRecommendedForHardware('llama3.2:3b')).toBe(true);
    });
  });

  describe('LibraryModelsProvider recommendedOnly behaviour', () => {
    it('filters flat list to recommended models only when recommendedOnly=true', async () => {
      // 8 GB total → available = 6 GB → threshold = 3.6 GB
      // tiny-llama-3b: memGB = 3 * 2 * 0.5 = 3 GB → fits
      // big-model-70b: memGB = 70 * 2 * 0.5 = 70 GB → does not fit
      vi.doMock('node:os', () => ({ totalmem: () => 8 * 1024 ** 3 }));
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          headers: { get: () => null },
          text: async () => '<a href="/library/tiny-llama-3b"></a><a href="/library/big-model-70b"></a>',
        }),
      );

      const { LibraryModelsProvider } = await import('./sidebar.js');
      const provider = new LibraryModelsProvider(undefined);
      provider.grouped = false;
      provider.recommendedOnly = true;

      const items = await provider.getChildren();
      const labels = items.map((i: any) => i.label);
      expect(labels).toContain('tiny-llama-3b');
      expect(labels).not.toContain('big-model-70b');
      provider.dispose();
    });

    it('shows all models when recommendedOnly=false', async () => {
      vi.doMock('node:os', () => ({ totalmem: () => 8 * 1024 ** 3 }));
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          headers: { get: () => null },
          text: async () => '<a href="/library/tiny-llama-3b"></a><a href="/library/big-model-70b"></a>',
        }),
      );

      const { LibraryModelsProvider } = await import('./sidebar.js');
      const provider = new LibraryModelsProvider(undefined);
      provider.grouped = false;
      provider.recommendedOnly = false;

      const items = await provider.getChildren();
      const labels = items.map((i: any) => i.label);
      expect(labels).toContain('tiny-llama-3b');
      expect(labels).toContain('big-model-70b');
      provider.dispose();
    });

    it('forces grouped=false on startup when both recommendedOnly and grouped are true', async () => {
      vi.doMock('node:os', () => ({ totalmem: () => 8 * 1024 ** 3 }));

      const { registerSidebar } = await import('./sidebar.js');
      const vscode = await import('vscode');

      const state: Record<string, unknown> = {
        'ollama.libraryGrouped': true,
        'ollama.libraryRecommendedOnly': true,
      };
      const globalStateUpdate = vi.fn((key: string, value: unknown) => {
        state[key] = value;
      });
      const mockContext = {
        subscriptions: { push: vi.fn() },
        secrets: { get: vi.fn().mockResolvedValue(undefined), store: vi.fn(), delete: vi.fn() },
        globalState: {
          get: vi.fn((key: string, def: unknown) => (key in state ? state[key] : def)),
          update: globalStateUpdate,
        },
      } as unknown as import('vscode').ExtensionContext;
      const mockClient = {
        list: vi.fn().mockResolvedValue({ models: [] }),
        generate: vi.fn(),
      } as unknown as import('ollama').Ollama;

      registerSidebar(mockContext, mockClient);

      // On startup, when recommendedOnly=true is restored alongside grouped=true,
      // the reconciliation logic must persist grouped=false and update the context.
      expect(globalStateUpdate).toHaveBeenCalledWith('ollama.libraryGrouped', false);
      expect(vi.mocked(vscode.commands.executeCommand)).toHaveBeenCalledWith(
        'setContext',
        'ollama.libraryGrouped',
        false,
      );
    });
  });
});
