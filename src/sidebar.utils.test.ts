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
});
