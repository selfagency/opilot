import { Ollama } from 'ollama';
import {
  commands,
  Event,
  EventEmitter,
  ExtensionContext,
  TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
  window,
  workspace,
} from 'vscode';

/**
 * Tree item representing a pane or model in the sidebar
 */
export class ModelTreeItem extends TreeItem {
  constructor(
    public readonly label: string,
    public readonly type: 'pane' | 'model' | 'running',
    public readonly size?: number,
  ) {
    super(label);
    this.contextValue = type;
    this.collapsibleState = type === 'pane' ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.None;

    if (type === 'model' || type === 'running') {
      this.description = this.formatSize(size);
    }
  }

  private formatSize(bytes?: number): string {
    if (!bytes) return '';
    const gb = bytes / 1024 ** 3;
    return gb.toFixed(1) + ' GB';
  }
}

/**
 * Ollama sidebar/activity bar view provider
 */
export class OllamaSidebarProvider implements TreeDataProvider<ModelTreeItem> {
  private treeChangeEmitter = new EventEmitter<ModelTreeItem | null>();
  readonly onDidChangeTreeData: Event<ModelTreeItem | null> = this.treeChangeEmitter.event;

  private panes: ModelTreeItem[] = [
    new ModelTreeItem('Library', 'pane'),
    new ModelTreeItem('Installed', 'pane'),
    new ModelTreeItem('Processes', 'pane'),
  ];

  constructor(private client: Ollama) {}

  /**
   * Get tree items for a given element
   */
  async getChildren(element?: ModelTreeItem): Promise<ModelTreeItem[]> {
    // Root level: return panes
    if (!element) {
      return this.panes;
    }

    // Pane level: return models
    if (element.type === 'pane') {
      switch (element.label) {
        case 'Installed':
          return this.getInstalledModels();
        case 'Processes':
          return this.getRunningModels();
        case 'Library':
          return this.getLibraryModels();
        default:
          return [];
      }
    }

    return [];
  }

  /**
   * Get tree item metadata
   */
  getTreeItem(element: ModelTreeItem): TreeItem {
    return element;
  }

  /**
   * Get installed models from Ollama
   */
  private async getInstalledModels(): Promise<ModelTreeItem[]> {
    try {
      const response = await this.client.list();
      return response.models.map(model => new ModelTreeItem(model.name, 'model', model.size));
    } catch {
      return [new ModelTreeItem('Failed to load models', 'model')];
    }
  }

  /**
   * Get running processes from Ollama
   */
  private async getRunningModels(): Promise<ModelTreeItem[]> {
    try {
      const response = await this.client.ps();
      return response.models.map(model => new ModelTreeItem(model.name, 'running', model.size));
    } catch {
      return [new ModelTreeItem('Failed to load running models', 'model')];
    }
  }

  /**
   * Get models available from library (placeholder for catalog fetching)
   */
  private async getLibraryModels(): Promise<ModelTreeItem[]> {
    return [new ModelTreeItem('Loading library...', 'model')];
  }

  /**
   * Refresh the tree
   */
  refresh(): void {
    this.treeChangeEmitter.fire(null);
  }

  /**
   * Delete a model
   */
  async deleteModel(modelName: string): Promise<void> {
    try {
      await this.client.delete({ model: modelName });
      this.refresh();
      window.showInformationMessage(`Model ${modelName} deleted`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      window.showErrorMessage(`Failed to delete model: ${msg}`);
    }
  }

  /**
   * Pull (download) a model
   */
  async pullModel(modelName: string): Promise<void> {
    try {
      window.withProgress(
        { location: 15, title: `Pulling ${modelName}...` }, // 15 = ProgressLocation.Window
        async () => {
          await this.client.pull({ model: modelName });
          this.refresh();
          window.showInformationMessage(`Model ${modelName} pulled successfully`);
        },
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      window.showErrorMessage(`Failed to pull model: ${msg}`);
    }
  }

  /**
   * Stop a running model
   */
  async stopModel(modelName: string): Promise<void> {
    try {
      // Ollama doesn't have a direct "stop" API, but models stop when no longer used
      // This is a placeholder for future implementation
      window.showInformationMessage(`Model stop not yet implemented for ${modelName}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      window.showErrorMessage(`Failed to stop model: ${msg}`);
    }
  }
}

/**
 * Register sidebar with VS Code
 */
export function registerSidebar(context: ExtensionContext, client: Ollama): void {
  const provider = new OllamaSidebarProvider(client);

  context.subscriptions.push(
    window.registerTreeDataProvider('ollama-sidebar', provider),
    commands.registerCommand('ollama-copilot.refreshSidebar', () => provider.refresh()),
    commands.registerCommand('ollama-copilot.deleteModel', (item: ModelTreeItem) => {
      if (item.type === 'model' || item.type === 'running') {
        void provider.deleteModel(item.label);
      }
    }),
    commands.registerCommand('ollama-copilot.pullModel', async () => {
      const modelName = await window.showInputBox({
        prompt: 'Enter model name or identifier (e.g., llama2, mistral:7b)',
        ignoreFocusOut: false,
      });
      if (modelName) {
        void provider.pullModel(modelName);
      }
    }),
    commands.registerCommand('ollama-copilot.stopModel', (item: ModelTreeItem) => {
      if (item.type === 'running') {
        void provider.stopModel(item.label);
      }
    }),
  );

  // Set up auto-refresh based on settings
  const config = workspace.getConfiguration('ollama');
  const refreshInterval = config.get<number>('refreshInterval') || 5;
  if (refreshInterval > 0) {
    setInterval(() => provider.refresh(), refreshInterval * 1000);
  }

  // Watch for settings changes
  workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('ollama.refreshInterval')) {
      const newInterval = workspace.getConfiguration('ollama').get<number>('refreshInterval') || 5;
      if (newInterval > 0) {
        setInterval(() => provider.refresh(), newInterval * 1000);
      }
    }
  });
}
