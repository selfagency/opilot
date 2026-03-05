import { Ollama } from 'ollama';
import {
  commands,
  Disposable,
  env,
  Event,
  EventEmitter,
  ExtensionContext,
  LogOutputChannel,
  ThemeIcon,
  TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
  Uri,
  WebviewView,
  WebviewViewProvider,
  window,
  workspace,
} from 'vscode';

/**
 * Tree item representing a pane or model in the sidebar
 */
export class ModelTreeItem extends TreeItem {
  constructor(
    public readonly label: string,
    public readonly type:
      | 'local-running'
      | 'local-stopped'
      | 'library-model'
      | 'cloud-running'
      | 'cloud-stopped'
      | 'status',
    public readonly size?: number,
    public readonly durationMs?: number,
  ) {
    super(label);
    this.contextValue = type;
    this.collapsibleState = TreeItemCollapsibleState.None;

    if (type === 'local-stopped' || type === 'cloud-stopped') {
      this.description = this.formatSize(size);
    } else if (type === 'local-running' || type === 'cloud-running') {
      this.iconPath = { id: 'play-circle' } as unknown as ThemeIcon;
      const sizeStr = this.formatSize(size);
      const durationStr = this.formatDuration(durationMs);
      this.description = [sizeStr, durationStr].filter(Boolean).join(' • ');
    }
  }

  private formatSize(bytes?: number): string {
    if (!bytes) return '';
    const gb = bytes / 1024 ** 3;
    return gb.toFixed(1) + ' GB';
  }

  private formatDuration(ms?: number): string {
    if (!ms) return '';
    const secs = Math.floor(ms / 1000);
    const mins = Math.floor(secs / 60);
    const hours = Math.floor(mins / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${mins % 60}m`;
    if (mins > 0) return `${mins}m ${secs % 60}s`;
    return `${secs}s`;
  }
}

function makeStatusItem(label: string): ModelTreeItem {
  return new ModelTreeItem(label, 'status');
}

type RunningProcessInfo = {
  id?: string;
  durationMs?: number;
  processor?: string;
};

function formatRelativeFromNow(ms?: number): string {
  if (typeof ms !== 'number') {
    return 'Not running';
  }

  if (ms <= 0) {
    return 'now';
  }

  const mins = Math.floor(ms / 60_000);
  if (mins >= 60) {
    const hours = Math.floor(mins / 60);
    return `${hours} hour${hours === 1 ? '' : 's'} from now`;
  }

  if (mins > 0) {
    return `${mins} minute${mins === 1 ? '' : 's'} from now`;
  }

  const secs = Math.floor(ms / 1000);
  return `${secs} second${secs === 1 ? '' : 's'} from now`;
}

function formatSizeForTooltip(bytes?: number): string {
  if (!bytes) {
    return 'Unknown';
  }

  const gb = bytes / 1024 ** 3;
  return `${gb.toFixed(1)} GB`;
}

function buildLocalModelTooltip(modelName: string, size?: number, running?: RunningProcessInfo): string {
  const id = running?.id ?? '—';
  const processor = running?.processor ?? (running ? 'Active' : 'Not running');
  const until = formatRelativeFromNow(running?.durationMs);
  const sizeText = formatSizeForTooltip(size);

  return [
    `${modelName}`,
    '',
    `Name      : ${modelName}`,
    `ID        : ${id}`,
    `Size      : ${sizeText}`,
    `Processor : ${processor}`,
    `Until     : ${until}`,
  ].join('\n');
}

function getLibraryModelUrl(modelName: string): string {
  const encoded = modelName
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/');
  return `https://ollama.com/library/${encoded}`;
}

function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function fetchModelPagePreview(
  modelName: string,
  timeoutMs = 8000,
): Promise<{ title: string; description: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const url = getLibraryModelUrl(modelName);

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    const descMatch = html.match(/<meta\s+name="description"\s+content="([^"]*)"/i);

    const title = titleMatch?.[1]?.trim() || modelName;
    const description = descMatch?.[1]?.trim() || 'No description available from the library page.';
    return { title, description };
  } finally {
    clearTimeout(timeout);
  }
}

class ModelPreviewViewProvider implements WebviewViewProvider {
  private view: WebviewView | undefined;

  resolveWebviewView(webviewView: WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: false };
    webviewView.webview.html = this.renderHtml('Model Preview', 'Select a library model and run Preview Model.');
  }

  setLoading(modelName: string): void {
    if (!this.view) {
      return;
    }
    this.view.webview.html = this.renderHtml(modelName, 'Loading model details...');
  }

  setModelPreview(modelName: string, title: string, description: string): void {
    if (!this.view) {
      return;
    }

    const modelUrl = getLibraryModelUrl(modelName);
    this.view.webview.html = `<!doctype html>
<html>
  <body style="font-family:var(--vscode-font-family);padding:12px;line-height:1.5;">
    <h3 style="margin:0 0 8px 0;">${escapeHtml(title)}</h3>
    <p style="margin:0 0 8px 0;"><strong>Model:</strong> ${escapeHtml(modelName)}</p>
    <p style="margin:0 0 10px 0;">${escapeHtml(description)}</p>
    <p style="margin:0;"><a href="${modelUrl}">Open on ollama.com ↗</a></p>
  </body>
</html>`;
  }

  setError(modelName: string, message: string): void {
    if (!this.view) {
      return;
    }

    const modelUrl = getLibraryModelUrl(modelName);
    this.view.webview.html = `<!doctype html>
<html>
  <body style="font-family:var(--vscode-font-family);padding:12px;line-height:1.5;">
    <h3 style="margin:0 0 8px 0;">${escapeHtml(modelName)}</h3>
    <p style="margin:0 0 10px 0;">Could not load model details: ${escapeHtml(message)}</p>
    <p style="margin:0;"><a href="${modelUrl}">Open on ollama.com ↗</a></p>
  </body>
</html>`;
  }

  private renderHtml(title: string, body: string): string {
    return `<!doctype html>
<html>
  <body style="font-family:var(--vscode-font-family);padding:12px;line-height:1.5;">
    <h3 style="margin:0 0 8px 0;">${escapeHtml(title)}</h3>
    <p style="margin:0;">${escapeHtml(body)}</p>
  </body>
</html>`;
  }
}

/**
 * Local models view provider (installed + running state)
 */
export class LocalModelsProvider implements TreeDataProvider<ModelTreeItem>, Disposable {
  private treeChangeEmitter = new EventEmitter<ModelTreeItem | null>();
  readonly onDidChangeTreeData: Event<ModelTreeItem | null> = this.treeChangeEmitter.event;

  private refreshTimeout: NodeJS.Timeout | null = null;
  private lastRefreshTime = 0;
  private refreshIntervals: NodeJS.Timeout[] = [];

  constructor(
    private client: Ollama,
    private logChannel?: LogOutputChannel,
  ) {
    this.startAutoRefresh();
  }

  /**
   * Get tree items for a given element
   */
  async getChildren(element?: ModelTreeItem): Promise<ModelTreeItem[]> {
    if (element) {
      return [];
    }

    return this.getLocalModels();
  }

  /**
   * Get tree item metadata
   */
  getTreeItem(element: ModelTreeItem): TreeItem {
    return element;
  }

  private async getLocalModels(): Promise<ModelTreeItem[]> {
    try {
      this.logChannel?.debug('[Ollama] Loading local models via list() and ps()...');
      const [listResponse, psResponse] = await Promise.all([this.client.list(), this.client.ps()]);

      const runningMap = new Map<string, RunningProcessInfo>();
      for (const model of psResponse.models) {
        const modelRecord = model as unknown as Record<string, unknown>;
        const durationMs = model.expires_at
          ? Math.max(0, new Date(model.expires_at).getTime() - Date.now())
          : undefined;
        const id = typeof modelRecord.digest === 'string' ? modelRecord.digest.slice(0, 12) : undefined;

        let processor: string | undefined;
        const sizeVram = typeof modelRecord.size_vram === 'number' ? modelRecord.size_vram : undefined;
        const size = typeof modelRecord.size === 'number' ? modelRecord.size : undefined;
        if (typeof sizeVram === 'number' && typeof size === 'number' && size > 0) {
          const gpuPct = Math.min(100, Math.max(0, Math.round((sizeVram / size) * 100)));
          processor = gpuPct > 0 ? `${gpuPct}% GPU` : 'CPU';
        }

        runningMap.set(model.name, { durationMs, id, processor });
      }

      const items = listResponse.models
        .map(model => {
          const running = runningMap.get(model.name);
          const item = new ModelTreeItem(
            model.name,
            running ? 'local-running' : 'local-stopped',
            model.size,
            running?.durationMs,
          );
          item.tooltip = buildLocalModelTooltip(model.name, model.size, running);
          if (running) {
            item.iconPath = { id: 'stop-circle' } as unknown as ThemeIcon;
            item.command = {
              command: 'ollama-copilot.stopModel',
              title: 'Stop Model',
              arguments: [item],
            };
          } else {
            item.iconPath = { id: 'play-circle' } as unknown as ThemeIcon;
            item.command = {
              command: 'ollama-copilot.startModel',
              title: 'Start Model',
              arguments: [item],
            };
          }
          return item;
        })
        .sort((a, b) => {
          if (a.type !== b.type) {
            return a.type === 'local-running' ? -1 : 1;
          }
          return a.label.localeCompare(b.label);
        });

      this.logChannel?.info(
        `[Ollama] Local models loaded: ${items.length} total, ${items.filter(m => m.type === 'local-running').length} running`,
      );

      return items.length > 0 ? items : [makeStatusItem('No local models found')];
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logChannel?.error(`[Ollama] Failed to load local models: ${msg}`);
      return [makeStatusItem('Failed to load local models')];
    }
  }

  /**
   * Refresh the tree (manual refresh button - forces immediate refresh)
   */
  refresh(): void {
    this.logChannel?.debug('[Ollama] Manual refresh triggered');
    this.lastRefreshTime = 0; // Force refresh
    this.treeChangeEmitter.fire(null);
  }

  /**
   * Debounced refresh that coalesces rapid refresh calls
   */
  private debouncedRefresh(): void {
    const debounceMs = workspace.getConfiguration('ollama').get<number>('debounceInterval') || 300;
    const now = Date.now();

    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
    }

    // Only refresh if debounce interval has passed
    if (now - this.lastRefreshTime >= debounceMs) {
      this.lastRefreshTime = now;
      this.treeChangeEmitter.fire(null);
    } else {
      // Schedule refresh for later
      this.refreshTimeout = setTimeout(
        () => {
          this.lastRefreshTime = Date.now();
          this.treeChangeEmitter.fire(null);
          this.refreshTimeout = null;
        },
        debounceMs - (now - this.lastRefreshTime),
      );
    }
  }

  /**
   * Start auto-refresh timer for local models
   */
  private startAutoRefresh(): void {
    const localRefreshSecs = workspace.getConfiguration('ollama').get<number>('localModelRefreshInterval') || 30;

    // Auto-refresh local/running models
    if (localRefreshSecs > 0) {
      this.logChannel?.debug(`[Ollama] Auto-refresh set for local models every ${localRefreshSecs}s`);
      const localInterval = setInterval(() => {
        this.debouncedRefresh();
      }, localRefreshSecs * 1000);
      this.refreshIntervals.push(localInterval);
    }

    // Watch for settings changes and restart intervals
    workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('ollama.localModelRefreshInterval')) {
        this.logChannel?.debug('[Ollama] Ollama settings changed, restarting auto-refresh');
        this.stopAutoRefresh();
        this.startAutoRefresh();
      }
    });
  }

  /**
   * Stop all auto-refresh timers
   */
  private stopAutoRefresh(): void {
    for (const interval of this.refreshIntervals) {
      clearInterval(interval);
    }
    this.refreshIntervals = [];
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.stopAutoRefresh();
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
    }
  }

  /**
   * Delete a model
   */
  async deleteModel(modelName: string): Promise<void> {
    try {
      this.logChannel?.debug(`[Ollama] Deleting model: ${modelName}`);
      await this.client.delete({ model: modelName });
      this.logChannel?.info(`[Ollama] Model deleted: ${modelName}`);
      this.refresh();
      window.showInformationMessage(`Model ${modelName} deleted`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.logChannel?.error(`[Ollama] Failed to delete model ${modelName}: ${msg}`);
      window.showErrorMessage(`Failed to delete model: ${msg}`);
    }
  }

  /**
   * Start (warm) a local model
   */
  async startModel(modelName: string): Promise<void> {
    try {
      this.logChannel?.debug(`[Ollama] Starting local model: ${modelName}`);
      window.withProgress({ location: 15, title: `Starting ${modelName}...` }, async () => {
        await this.client.generate({ model: modelName, prompt: '', stream: false, keep_alive: '10m' });
        this.logChannel?.info(`[Ollama] Model started: ${modelName}`);
        this.refresh();
        window.showInformationMessage(`Model ${modelName} started`);
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.logChannel?.error(`[Ollama] Failed to start model ${modelName}: ${msg}`);
      window.showErrorMessage(`Failed to start model: ${msg}`);
    }
  }

  /**
   * Stop a running model
   */
  async stopModel(modelName: string): Promise<void> {
    try {
      this.logChannel?.debug(`[Ollama] Stopping model: ${modelName}`);
      await this.client.generate({ model: modelName, prompt: '', stream: false, keep_alive: 0 });
      this.logChannel?.info(`[Ollama] Model stopped: ${modelName}`);
      this.refresh();
      window.showInformationMessage(`Model ${modelName} stopped`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.logChannel?.error(`[Ollama] Failed to stop model ${modelName}: ${msg}`);
      window.showErrorMessage(`Failed to stop model: ${msg}`);
    }
  }
}

/**
 * Remote library models view provider
 */
export class LibraryModelsProvider implements TreeDataProvider<ModelTreeItem>, Disposable {
  private treeChangeEmitter = new EventEmitter<ModelTreeItem | null>();
  readonly onDidChangeTreeData: Event<ModelTreeItem | null> = this.treeChangeEmitter.event;

  private cache: ModelTreeItem[] = [];
  private cacheTimeMs = 0;
  private refreshTimeout: NodeJS.Timeout | null = null;
  private refreshIntervals: NodeJS.Timeout[] = [];
  private loadPromise: Promise<ModelTreeItem[]> | null = null;

  constructor(
    private getCloudModelNames: () => Promise<Set<string>>,
    private logChannel?: LogOutputChannel,
  ) {
    this.startAutoRefresh();
  }

  getTreeItem(element: ModelTreeItem): TreeItem {
    return element;
  }

  async getChildren(element?: ModelTreeItem): Promise<ModelTreeItem[]> {
    if (element) {
      return [];
    }

    return this.getLibraryModels();
  }

  refresh(): void {
    this.cache = [];
    this.cacheTimeMs = 0;
    this.treeChangeEmitter.fire(null);
  }

  dispose(): void {
    for (const interval of this.refreshIntervals) {
      clearInterval(interval);
    }
    this.refreshIntervals = [];
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
    }
  }

  private async getLibraryModels(): Promise<ModelTreeItem[]> {
    const cacheTtlMs = 10 * 60 * 1000;
    if (this.cache.length > 0 && Date.now() - this.cacheTimeMs < cacheTtlMs) {
      return this.cache;
    }

    if (this.loadPromise) {
      return this.loadPromise;
    }

    this.loadPromise = this.fetchLibraryModels(12000)
      .then(items => {
        this.cache = items;
        this.cacheTimeMs = Date.now();
        return items;
      })
      .catch(error => {
        const msg = error instanceof Error ? error.message : String(error);
        this.logChannel?.error(`[Ollama] Library fetch failed: ${msg}`);
        return [makeStatusItem('Failed to load library models')];
      })
      .finally(() => {
        this.loadPromise = null;
      });

    return this.loadPromise;
  }

  private async fetchLibraryModels(timeoutMs: number): Promise<ModelTreeItem[]> {
    this.logChannel?.debug(`[Ollama] Fetching remote model library from ollama.com (timeout=${timeoutMs}ms)`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch('https://ollama.com/library', {
        method: 'GET',
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} from remote library`);
      }

      const html = await response.text();
      const matches = [...html.matchAll(/href="\/library\/([^"?#]+)"/g)];
      const names = [
        ...new Set(
          matches
            .map(match => (typeof match[1] === 'string' ? decodeURIComponent(match[1]).trim() : ''))
            .filter(Boolean),
        ),
      ];
      const cloudNames = await this.getCloudModelNames();

      const filteredNames = names.filter(name => {
        const normalized = name.toLowerCase();
        if (normalized.startsWith('cloud/')) {
          return false;
        }
        if (normalized.includes('/cloud/')) {
          return false;
        }
        return !cloudNames.has(name);
      });

      if (filteredNames.length === 0) {
        throw new Error('No model names parsed from library page');
      }

      const items = filteredNames.slice(0, 200).map(name => new ModelTreeItem(name, 'library-model'));
      for (const item of items) {
        item.iconPath = { id: 'cloud-download' } as unknown as ThemeIcon;
        item.command = {
          command: 'ollama-copilot.pullModelFromLibrary',
          title: 'Pull Model',
          arguments: [item],
        };
      }
      this.logChannel?.info(`[Ollama] Library loaded with ${items.length} models`);
      return items;
    } finally {
      clearTimeout(timeout);
    }
  }

  private startAutoRefresh(): void {
    const libraryRefreshSecs = workspace.getConfiguration('ollama').get<number>('libraryRefreshInterval') || 21600;
    if (libraryRefreshSecs > 0) {
      const timer = setInterval(() => {
        this.refresh();
      }, libraryRefreshSecs * 1000);
      this.refreshIntervals.push(timer);
    }

    workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('ollama.libraryRefreshInterval')) {
        for (const interval of this.refreshIntervals) {
          clearInterval(interval);
        }
        this.refreshIntervals = [];
        this.startAutoRefresh();
      }
    });
  }
}

/**
 * Cloud models view provider (requires dedicated Ollama Cloud API key)
 */
export class CloudModelsProvider implements TreeDataProvider<ModelTreeItem>, Disposable {
  private treeChangeEmitter = new EventEmitter<ModelTreeItem | null>();
  readonly onDidChangeTreeData: Event<ModelTreeItem | null> = this.treeChangeEmitter.event;

  private cache: ModelTreeItem[] = [];
  private cacheTimeMs = 0;
  private loadPromise: Promise<ModelTreeItem[]> | null = null;
  private refreshIntervals: NodeJS.Timeout[] = [];
  private cachedNames = new Set<string>();

  constructor(
    private context: ExtensionContext,
    private logChannel?: LogOutputChannel,
  ) {
    this.startAutoRefresh();
  }

  getTreeItem(element: ModelTreeItem): TreeItem {
    return element;
  }

  async getChildren(element?: ModelTreeItem): Promise<ModelTreeItem[]> {
    if (element) {
      return [];
    }
    return this.getCloudModels();
  }

  refresh(): void {
    this.cache = [];
    this.cacheTimeMs = 0;
    this.treeChangeEmitter.fire(null);
  }

  getCachedModelNames(): Set<string> {
    return new Set(this.cachedNames);
  }

  async getCloudModelNamesForFilter(): Promise<Set<string>> {
    try {
      await this.getCloudModels();
      return new Set(this.cachedNames);
    } catch {
      return new Set();
    }
  }

  dispose(): void {
    for (const interval of this.refreshIntervals) {
      clearInterval(interval);
    }
    this.refreshIntervals = [];
  }

  private async getCloudModels(): Promise<ModelTreeItem[]> {
    const cloudApiKey = await this.context.secrets.get('ollama-cloud-api-key');
    if (!cloudApiKey) {
      return [makeStatusItem('Add Ollama Cloud API key to view cloud models')];
    }

    const cacheTtlMs = 5 * 60 * 1000;
    if (this.cache.length > 0 && Date.now() - this.cacheTimeMs < cacheTtlMs) {
      return this.cache;
    }

    if (this.loadPromise) {
      return this.loadPromise;
    }

    this.loadPromise = this.fetchCloudModels(cloudApiKey, 12000)
      .then(items => {
        this.cache = items;
        this.cacheTimeMs = Date.now();
        this.cachedNames = new Set(items.map(item => item.label));
        return items;
      })
      .catch(error => {
        const msg = error instanceof Error ? error.message : String(error);
        this.logChannel?.error(`[Ollama] Cloud models fetch failed: ${msg}`);
        return [makeStatusItem('Failed to load cloud models')];
      })
      .finally(() => {
        this.loadPromise = null;
      });

    return this.loadPromise;
  }

  private async fetchCloudModels(apiKey: string, timeoutMs: number): Promise<ModelTreeItem[]> {
    this.logChannel?.debug(`[Ollama] Fetching cloud models (timeout=${timeoutMs}ms)`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch('https://ollama.com/api/tags', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} from cloud models endpoint`);
      }

      const json = (await response.json()) as {
        models?: Array<{ name: string; size?: number; expires_at?: string }>;
      };

      const models = json.models ?? [];
      const items = models
        .map(model => {
          const durationMs = model.expires_at
            ? Math.max(0, new Date(model.expires_at).getTime() - Date.now())
            : undefined;
          const isRunning = typeof durationMs === 'number' && durationMs > 0;
          const item = new ModelTreeItem(
            model.name,
            isRunning ? 'cloud-running' : 'cloud-stopped',
            model.size,
            durationMs,
          );
          if (isRunning) {
            item.iconPath = { id: 'stop-circle' } as unknown as ThemeIcon;
            item.command = {
              command: 'ollama-copilot.stopCloudModel',
              title: 'Stop Cloud Model',
              arguments: [item],
            };
          } else {
            item.iconPath = { id: 'play-circle' } as unknown as ThemeIcon;
            item.command = {
              command: 'ollama-copilot.startCloudModel',
              title: 'Run Cloud Model',
              arguments: [item],
            };
          }
          return item;
        })
        .sort((a, b) => {
          if (a.type !== b.type) {
            return a.type === 'cloud-running' ? -1 : 1;
          }
          return a.label.localeCompare(b.label);
        });

      this.logChannel?.info(
        `[Ollama] Cloud models loaded: ${items.length} total, ${items.filter(m => m.type === 'cloud-running').length} running`,
      );

      return items.length > 0 ? items : [makeStatusItem('No cloud models found')];
    } finally {
      clearTimeout(timeout);
    }
  }

  private startAutoRefresh(): void {
    const localRefreshSecs = workspace.getConfiguration('ollama').get<number>('localModelRefreshInterval') || 30;
    if (localRefreshSecs > 0) {
      const timer = setInterval(() => {
        this.refresh();
      }, localRefreshSecs * 1000);
      this.refreshIntervals.push(timer);
    }

    workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('ollama.localModelRefreshInterval')) {
        for (const interval of this.refreshIntervals) {
          clearInterval(interval);
        }
        this.refreshIntervals = [];
        this.startAutoRefresh();
      }
    });
  }
}

/**
 * Register sidebar with VS Code
 */
export function registerSidebar(context: ExtensionContext, client: Ollama, logChannel?: LogOutputChannel): void {
  const localProvider = new LocalModelsProvider(client, logChannel);
  const cloudProvider = new CloudModelsProvider(context, logChannel);
  const libraryProvider = new LibraryModelsProvider(() => cloudProvider.getCloudModelNamesForFilter(), logChannel);
  const previewProvider = new ModelPreviewViewProvider();

  logChannel?.info('[Ollama] Sidebar providers initialized');

  context.subscriptions.push(
    window.registerTreeDataProvider('ollama-local-models', localProvider),
    window.registerTreeDataProvider('ollama-library-models', libraryProvider),
    window.registerTreeDataProvider('ollama-cloud-models', cloudProvider),
    window.registerWebviewViewProvider('ollama-model-preview', previewProvider),
    commands.registerCommand('ollama-copilot.refreshSidebar', () => {
      localProvider.refresh();
      window.showInformationMessage('Local models refreshed');
    }),
    commands.registerCommand('ollama-copilot.refreshLocalModels', () => {
      localProvider.refresh();
      window.showInformationMessage('Local models refreshed');
    }),
    commands.registerCommand('ollama-copilot.refreshLibrary', () => {
      libraryProvider.refresh();
      window.showInformationMessage('Library catalog refreshed');
    }),
    commands.registerCommand('ollama-copilot.refreshCloudModels', () => {
      cloudProvider.refresh();
      window.showInformationMessage('Cloud models refreshed');
    }),
    commands.registerCommand('ollama-copilot.manageCloudApiKey', async () => {
      const existing = await context.secrets.get('ollama-cloud-api-key');
      const entered = await window.showInputBox({
        prompt: existing ? 'Update Ollama Cloud API key (leave empty to cancel)' : 'Enter Ollama Cloud API key',
        password: true,
        ignoreFocusOut: true,
      });

      if (!entered) {
        return;
      }

      await context.secrets.store('ollama-cloud-api-key', entered.trim());
      logChannel?.info('[Ollama] Cloud API key updated');
      cloudProvider.refresh();
      libraryProvider.refresh();
      window.showInformationMessage('Ollama Cloud API key saved');
    }),
    commands.registerCommand('ollama-copilot.deleteModel', (item: ModelTreeItem) => {
      if (item && (item.type === 'local-running' || item.type === 'local-stopped')) {
        void localProvider.deleteModel(item.label);
      }
    }),
    commands.registerCommand('ollama-copilot.pullModel', async () => {
      const modelName = await window.showInputBox({
        prompt: 'Enter model name or identifier (e.g., llama2, mistral:7b)',
        ignoreFocusOut: false,
      });
      if (modelName) {
        void client.pull({ model: modelName }).then(
          () => {
            logChannel?.info(`[Ollama] Model pulled successfully: ${modelName}`);
            localProvider.refresh();
            window.showInformationMessage(`Model ${modelName} pulled successfully`);
          },
          error => {
            const msg = error instanceof Error ? error.message : String(error);
            logChannel?.error(`[Ollama] Failed to pull model ${modelName}: ${msg}`);
            window.showErrorMessage(`Failed to pull model: ${msg}`);
          },
        );
      }
    }),
    commands.registerCommand('ollama-copilot.pullModelFromLibrary', (item: ModelTreeItem) => {
      if (item && item.type === 'library-model') {
        void client.pull({ model: item.label }).then(
          () => {
            logChannel?.info(`[Ollama] Model pulled successfully from library: ${item.label}`);
            localProvider.refresh();
            window.showInformationMessage(`Model ${item.label} pulled successfully`);
          },
          error => {
            const msg = error instanceof Error ? error.message : String(error);
            logChannel?.error(`[Ollama] Failed to pull model ${item.label}: ${msg}`);
            window.showErrorMessage(`Failed to pull model: ${msg}`);
          },
        );
      }
    }),
    commands.registerCommand('ollama-copilot.openLibraryModelPage', (item: ModelTreeItem) => {
      if (item && item.type === 'library-model') {
        void env.openExternal(Uri.parse(getLibraryModelUrl(item.label)));
      }
    }),
    commands.registerCommand('ollama-copilot.previewLibraryModel', (item: ModelTreeItem) => {
      if (!item || item.type !== 'library-model') {
        return;
      }
      previewProvider.setLoading(item.label);
      void commands.executeCommand('ollama-model-preview.focus');
      void fetchModelPagePreview(item.label)
        .then(preview => {
          previewProvider.setModelPreview(item.label, preview.title, preview.description);
        })
        .catch(error => {
          const message = error instanceof Error ? error.message : String(error);
          previewProvider.setError(item.label, message);
        });
    }),
    commands.registerCommand('ollama-copilot.startModel', (item: ModelTreeItem) => {
      if (item && item.type === 'local-stopped') {
        void localProvider.startModel(item.label);
      }
    }),
    commands.registerCommand('ollama-copilot.stopModel', (item: ModelTreeItem) => {
      if (item && (item.type === 'local-running' || item.type === 'cloud-running')) {
        void localProvider.stopModel(item.label);
      }
    }),
    commands.registerCommand('ollama-copilot.startCloudModel', (item: ModelTreeItem) => {
      if (item && item.type === 'cloud-stopped') {
        void localProvider.startModel(item.label);
      }
    }),
    commands.registerCommand('ollama-copilot.stopCloudModel', (item: ModelTreeItem) => {
      if (item && item.type === 'cloud-running') {
        void localProvider.stopModel(item.label);
      }
    }),
    { dispose: () => localProvider.dispose() },
    { dispose: () => libraryProvider.dispose() },
    { dispose: () => cloudProvider.dispose() },
  );
}
