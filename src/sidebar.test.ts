import type { Ollama } from 'ollama';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('OllamaSidebarProvider', () => {
  let provider: any;
  let mockClient: Ollama;
  let MockModule: any;

  beforeEach(async () => {
    // Mock vscode module before importing sidebar
    vi.resetModules();
    vi.doMock('vscode', () => ({
      TreeItem: class {
        label: string;
        description?: string;
        contextValue?: string;
        collapsibleState?: number;

        constructor(label: string) {
          this.label = label;
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
        withProgress: vi.fn(async (_options: any, callback: any) => callback({})),
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
            if (key === 'refreshInterval') return 5;
            return undefined;
          }),
        })),
        onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
      },
    }));

    // Import after mocking
    const sidebarModule = await import('./sidebar.js');
    const OllamaSidebarProvider = sidebarModule.OllamaSidebarProvider;
    const ModelTreeItem = sidebarModule.ModelTreeItem;

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
        models: [{ name: 'llama2:latest', digest: 'abc123', size: 3826087936, until: '2026-03-05T00:00:00Z' }],
      }),
    } as any;

    provider = new OllamaSidebarProvider(mockClient);
    MockModule = { OllamaSidebarProvider, ModelTreeItem };
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe('getChildren', () => {
    it('should return three root panes: Library, Installed, Processes', async () => {
      const root = await provider.getChildren();
      expect(root).toHaveLength(3);
      expect(root[0].label).toBe('Library');
      expect(root[1].label).toBe('Installed');
      expect(root[2].label).toBe('Processes');
    });

    it('should return installed models for Installed pane', async () => {
      const root = await provider.getChildren();
      const installedPane = root[1];
      const models = await provider.getChildren(installedPane);

      expect(models.length).toBeGreaterThan(0);
      expect(models[0].label).toContain('llama2');
    });

    it('should return running models for Processes pane', async () => {
      const root = await provider.getChildren();
      const processesPane = root[2];
      const models = await provider.getChildren(processesPane);

      expect(models.length).toEqual(1);
      expect(models[0].label).toContain('llama2');
    });
  });

  describe('getTreeItem', () => {
    it('should return tree item for a model', async () => {
      const { ModelTreeItem } = MockModule;
      const item = new ModelTreeItem('llama2:latest', 'model', 3826087936);
      const treeItem = provider.getTreeItem(item);

      expect(treeItem.label).toBe('llama2:latest');
      expect(treeItem.description).toContain('3.6');
    });
  });
});
