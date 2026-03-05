import type { Ollama } from 'ollama';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('LocalModelsProvider', () => {
  let provider: any;
  let mockClient: Ollama;
  let ModelTreeItem: any;
  let LocalModelsProvider: any;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('vscode', () => ({
      TreeItem: class {
        label: string;
        description?: string;
        contextValue?: string;
        collapsibleState?: number;
        iconPath?: unknown;

        constructor(label: string) {
          this.label = label;
        }
      },
      ThemeIcon: class {},
      MarkdownString: class {
        value = '';
        isTrusted = false;

        appendMarkdown(text: string) {
          this.value += text;
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
        withProgress: vi.fn(async (_options: unknown, callback: () => Promise<void>) => callback()),
        showInputBox: vi.fn(),
        showErrorMessage: vi.fn(),
        showInformationMessage: vi.fn(),
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
            if (key === 'debounceInterval') return 100;
            return undefined;
          }),
        })),
        onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
      },
    }));

    const sidebarModule = await import('./sidebar.js');
    LocalModelsProvider = sidebarModule.LocalModelsProvider;
    ModelTreeItem = sidebarModule.ModelTreeItem;

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
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('returns local models sorted with running models first', async () => {
    const models = await provider.getChildren();

    expect(models).toHaveLength(2);
    expect(models[0].label).toBe('llama2:latest');
    expect(models[0].contextValue).toBe('local-running');
    expect(models[1].label).toBe('mistral:latest');
    expect(models[1].contextValue).toBe('local-stopped');
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
});
