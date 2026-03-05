import { Ollama } from 'ollama';
import {
  commands,
  Disposable,
  env,
  Event,
  EventEmitter,
  ExtensionContext,
  TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
  Uri,
  WebviewView,
  WebviewViewProvider,
  window,
  workspace,
} from 'vscode';
import type { DiagnosticsLogger } from './diagnostics.js';

type LibrarySortMode = 'name' | 'recency';

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

function buildLocalModelTooltip(
  modelName: string,
  size?: number,
  running?: RunningProcessInfo,
  description?: string,
): string {
  const id = running?.id ?? '—';
  const processor = running?.processor ?? (running ? 'Active' : 'Not running');
  const until = formatRelativeFromNow(running?.durationMs);
  const sizeText = formatSizeForTooltip(size);
  const lines = [`${modelName}`];
  if (description) lines.push('', description);
  lines.push('', `🧠 ${modelName}`, `🆔 ${id}`, `🏋️ ${sizeText}`, `⚙️ ${processor}`, `⏱️ ${until}`);
  return lines.join('\n');
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

export class ModelPreviewViewProvider implements WebviewViewProvider {
  private view: WebviewView | undefined;

  resolveWebviewView(webviewView: WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: false };
    webviewView.webview.html = this.renderHtml(
      'Model Details',
      'Select a model in Local, Cloud, or Library to see details.',
    );
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
    this.view.webview.html = this.renderHtml(title, description, modelName, {
      href: modelUrl,
      label: 'Open on ollama.com ↗',
    });
  }

  setModelDetails(title: string, modelName: string, description: string): void {
    if (!this.view) {
      return;
    }

    this.view.webview.html = this.renderHtml(title, description, modelName);
  }

  setError(modelName: string, message: string): void {
    if (!this.view) {
      return;
    }

    const modelUrl = getLibraryModelUrl(modelName);
    this.view.webview.html = this.renderHtml(modelName, `Could not load model details: ${message}`, modelName, {
      href: modelUrl,
      label: 'Open on ollama.com ↗',
    });
  }

  private renderHtml(title: string, body: string, _modelName?: string, link?: { href: string; label: string }): string {
    const cspSource = this.view?.webview.cspSource ?? "'none'";
    const linkLine = link
      ? `<p style="margin:0;"><a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a></p>`
      : '';

    return `<!doctype html>
<html>
  <head>
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; img-src ${cspSource} https:; font-src ${cspSource};">
  </head>
  <body style="font-family:var(--vscode-font-family);padding:12px;line-height:1.5;">
    <h3 style="margin:0 0 8px 0;">${escapeHtml(title)}</h3>
    <p style="margin:0 0 10px 0;">${escapeHtml(body)}</p>
    ${linkLine}
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

  private refreshIntervals: NodeJS.Timeout[] = [];

  constructor(
    private client: Ollama,
    private logChannel?: DiagnosticsLogger,
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
          // Set initial tooltip
          item.tooltip = buildLocalModelTooltip(model.name, model.size, running);
          // Fetch description asynchronously
          void fetchModelPagePreview(model.name).then(
            preview => {
              item.tooltip = buildLocalModelTooltip(model.name, model.size, running, preview.description);
              this.treeChangeEmitter.fire(item);
            },
            () => {
              // Keep initial tooltip on error
            },
          );

          item.command = {
            command: 'ollama-copilot.showModelDetails',
            title: 'Model Details',
            arguments: [item],
          };
          return item;
        })
        .sort((a, b) => {
          return a.label.localeCompare(b.label);
        });

      this.logChannel?.info(
        `[Ollama] Local models loaded: ${items.length} total, ${items.filter(m => m.type === 'local-running').length} running`,
      );

      return items.length > 0 ? items : [makeStatusItem('No local models found')];
    } catch (error) {
      this.logChannel?.exception('[Ollama] Failed to load local models', error);
      return [makeStatusItem('Failed to load local models')];
    }
  }

  /**
   * Refresh the tree (manual refresh button - forces immediate refresh)
   */
  refresh(): void {
    this.logChannel?.debug('[Ollama] Manual refresh triggered');
    this.treeChangeEmitter.fire(null);
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
        this.refresh();
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
      this.logChannel?.exception(`[Ollama] Failed to delete model ${modelName}`, error);
      const msg = error instanceof Error ? error.message : 'Unknown error';
      window.showErrorMessage(`Failed to delete model: ${msg}`);
    }
  }

  /**
   * Start (warm) a local model
   */
  async startModel(modelName: string): Promise<void> {
    try {
      this.logChannel?.debug(`[Ollama] Starting local model: ${modelName}`);
      await window.withProgress({ location: 15, title: `Starting ${modelName}...` }, async () => {
        await this.client.generate({ model: modelName, prompt: '', stream: false, keep_alive: '10m' });
        this.logChannel?.info(`[Ollama] Model started: ${modelName}`);
        this.refresh();
        window.showInformationMessage(`Model ${modelName} started`);
      });
    } catch (error) {
      this.logChannel?.exception(`[Ollama] Failed to start model ${modelName}`, error);
      const msg = error instanceof Error ? error.message : 'Unknown error';
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
      this.logChannel?.exception(`[Ollama] Failed to stop model ${modelName}`, error);
      const msg = error instanceof Error ? error.message : 'Unknown error';
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

  private cache: string[] = [];
  private cacheTimeMs = 0;
  private refreshTimeout: NodeJS.Timeout | null = null;
  private refreshIntervals: NodeJS.Timeout[] = [];
  private loadPromise: Promise<string[]> | null = null;
  private sortMode: LibrarySortMode;

  constructor(
    private getCloudModelNames: () => Promise<Set<string>>,
    private logChannel?: DiagnosticsLogger,
  ) {
    this.sortMode = this.getSortModeFromConfig();
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

  getSortMode(): LibrarySortMode {
    return this.sortMode;
  }

  setSortMode(mode: LibrarySortMode): void {
    if (this.sortMode === mode) {
      return;
    }

    this.sortMode = mode;
    void workspace.getConfiguration('ollama').update('librarySortMode', mode, true);
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
      return this.buildItems(this.cache);
    }

    if (this.loadPromise) {
      const pendingNames = await this.loadPromise;
      if (pendingNames.length === 0) {
        return [makeStatusItem('Failed to load library models')];
      }
      return this.buildItems(pendingNames);
    }

    this.loadPromise = this.fetchLibraryModelNames(12000)
      .then(names => {
        this.cache = names;
        this.cacheTimeMs = Date.now();
        return names;
      })
      .catch(error => {
        this.logChannel?.exception('[Ollama] Library fetch failed', error);
        return [];
      })
      .finally(() => {
        this.loadPromise = null;
      });

    const names = await this.loadPromise;
    if (names.length === 0) {
      return [makeStatusItem('Failed to load library models')];
    }

    return this.buildItems(names);
  }

  private async fetchLibraryModelNames(timeoutMs: number): Promise<string[]> {
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
      const parsedNames = [
        ...new Set(
          matches
            .map(match => (typeof match[1] === 'string' ? decodeURIComponent(match[1]).trim() : ''))
            .filter(Boolean),
        ),
      ];
      const cloudNames = await this.getCloudModelNames();

      const filteredNames = parsedNames.filter(name => {
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

      const limitedNames = filteredNames.slice(0, 200);
      this.logChannel?.info(`[Ollama] Library loaded with ${limitedNames.length} models`);
      return limitedNames;
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildItems(names: string[]): ModelTreeItem[] {
    const sortedNames = this.sortNames(names);
    const items = sortedNames.map(name => {
      const item = new ModelTreeItem(name, 'library-model');
      item.tooltip = `Click to open ${name} on ollama.com`;
      // Fetch description asynchronously
      void fetchModelPagePreview(name).then(
        preview => {
          item.tooltip = preview.description;
          this.treeChangeEmitter.fire(item);
        },
        () => {
          item.tooltip = `Library model: ${name}`;
        },
      );
      item.command = {
        command: 'ollama-copilot.openLibraryModel',
        title: 'Open Model',
        arguments: [name],
      };
      return item;
    });

    return items.length > 0 ? items : [makeStatusItem('No library models found')];
  }

  private sortNames(names: string[]): string[] {
    if (this.sortMode === 'name') {
      return [...names].sort((a, b) => a.localeCompare(b));
    }

    // Recency mode: return array in order fetched (newest first from the HTML)
    return names;
  }

  private getSortModeFromConfig(): LibrarySortMode {
    const value = workspace.getConfiguration('ollama').get<string>('librarySortMode');
    return value === 'recency' ? 'recency' : 'name';
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

      if (e.affectsConfiguration('ollama.librarySortMode')) {
        this.sortMode = this.getSortModeFromConfig();
        this.treeChangeEmitter.fire(null);
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
    private logChannel?: DiagnosticsLogger,
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
        this.logChannel?.exception('[Ollama] Cloud models fetch failed', error);
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
            undefined,
            durationMs,
          );
          item.tooltip = `Cloud model: ${model.name}`;

          item.command = {
            command: 'ollama-copilot.openCloudModel',
            title: 'Open Model',
            arguments: [model.name],
          };
          return item;
        })
        .sort((a, b) => a.label.localeCompare(b.label));

      this.logChannel?.info(
        `[Ollama] Cloud models loaded: ${items.length} total, ${items.filter(m => m.type === 'cloud-running').length} running`,
      );

      return items.length > 0 ? items : [makeStatusItem('No cloud models found')];
    } finally {
      clearTimeout(timeout);
    }
  }

  private startAutoRefresh(): void {
    const cloudRefreshSecs = workspace.getConfiguration('ollama').get<number>('libraryRefreshInterval') || 21600;
    if (cloudRefreshSecs > 0) {
      const timer = setInterval(() => {
        this.refresh();
      }, cloudRefreshSecs * 1000);
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
 * Command handler: refresh local models
 */
export function handleRefreshLocalModels(localProvider: LocalModelsProvider): void {
  localProvider.refresh();
  window.showInformationMessage('Local models refreshed');
}

/**
 * Command handler: refresh library
 */
export function handleRefreshLibrary(libraryProvider: LibraryModelsProvider): void {
  libraryProvider.refresh();
  window.showInformationMessage('Library catalog refreshed');
}

/**
 * Command handler: refresh cloud models
 */
export function handleRefreshCloudModels(cloudProvider: CloudModelsProvider): void {
  cloudProvider.refresh();
  window.showInformationMessage('Cloud models refreshed');
}

/**
 * Command handler: sort library by recency
 */
export function handleSortLibraryByRecency(
  libraryProvider: LibraryModelsProvider,
  syncLibrarySortContext: () => void,
): void {
  libraryProvider.setSortMode('recency');
  syncLibrarySortContext();
  window.showInformationMessage('Library sorting set to recency');
}

/**
 * Command handler: sort library by name
 */
export function handleSortLibraryByName(
  libraryProvider: LibraryModelsProvider,
  syncLibrarySortContext: () => void,
): void {
  libraryProvider.setSortMode('name');
  syncLibrarySortContext();
  window.showInformationMessage('Library sorting set to name');
}

/**
 * Command handler: manage cloud API key
 */
export async function handleManageCloudApiKey(
  context: ExtensionContext,
  cloudProvider: CloudModelsProvider,
  libraryProvider: LibraryModelsProvider,
  logChannel?: DiagnosticsLogger,
): Promise<void> {
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
}

/**
 * Command handler: open library model page
 */
export function handleOpenLibraryModel(modelName: string): void {
  void env.openExternal(Uri.parse(getLibraryModelUrl(modelName)));
}

/**
 * Command handler: open cloud model page
 */
export function handleOpenCloudModel(modelName: string): void {
  void env.openExternal(Uri.parse(`https://ollama.com/library/${encodeURIComponent(modelName)}`));
}

/**
 * Command handler: delete model
 */
export function handleDeleteModel(item: ModelTreeItem, localProvider: LocalModelsProvider): void {
  if (item && (item.type === 'local-running' || item.type === 'local-stopped')) {
    void localProvider.deleteModel(item.label);
  }
}

/**
 * Command handler: pull model
 */
export async function handlePullModel(
  client: Ollama,
  localProvider: LocalModelsProvider,
  logChannel?: DiagnosticsLogger,
): Promise<void> {
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
        logChannel?.exception(`[Ollama] Failed to pull model ${modelName}`, error);
        const msg = error instanceof Error ? error.message : String(error);
        window.showErrorMessage(`Failed to pull model: ${msg}`);
      },
    );
  }
}

/**
 * Command handler: pull model from library
 */
export function handlePullModelFromLibrary(
  item: ModelTreeItem,
  client: Ollama,
  localProvider: LocalModelsProvider,
  logChannel?: DiagnosticsLogger,
): void {
  if (item && item.type === 'library-model') {
    void client.pull({ model: item.label }).then(
      () => {
        logChannel?.info(`[Ollama] Model pulled successfully from library: ${item.label}`);
        localProvider.refresh();
        window.showInformationMessage(`Model ${item.label} pulled successfully`);
      },
      error => {
        logChannel?.exception(`[Ollama] Failed to pull model ${item.label}`, error);
        const msg = error instanceof Error ? error.message : String(error);
        window.showErrorMessage(`Failed to pull model: ${msg}`);
      },
    );
  }
}

/**
 * Command handler: open library model page
 */
export function handleOpenLibraryModelPage(item: ModelTreeItem): void {
  if (item && item.type === 'library-model') {
    void env.openExternal(Uri.parse(getLibraryModelUrl(item.label)));
  }
}

/**
 * Command handler: show model details
 */
export function handleShowModelDetails(
  item: ModelTreeItem,
  previewProvider: ModelPreviewViewProvider,
  _logChannel?: DiagnosticsLogger,
): void {
  if (!item || item.type === 'status') {
    return;
  }

  if (item.type === 'library-model') {
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
    return;
  }

  const location = item.type.startsWith('cloud-') ? 'Cloud' : 'Local';
  const status = item.type.endsWith('running') ? 'Running' : 'Stopped';
  const descriptionParts = [`Location: ${location}`, `Status: ${status}`];

  if (item.description) {
    descriptionParts.push(`Info: ${item.description}`);
  }

  previewProvider.setModelDetails('Model Details', item.label, descriptionParts.join(' • '));
  void commands.executeCommand('ollama-model-preview.focus');
}

/**
 * Command handler: preview library model
 */
export function handlePreviewLibraryModel(item: ModelTreeItem, _previewProvider?: ModelPreviewViewProvider): void {
  if (!item || item.type !== 'library-model') {
    return;
  }
  void commands.executeCommand('ollama-copilot.showModelDetails', item);
}

/**
 * Command handler: start model
 */
export function handleStartModel(item: ModelTreeItem, localProvider: LocalModelsProvider): void {
  if (item && item.type === 'local-stopped') {
    void localProvider.startModel(item.label);
  }
}

/**
 * Command handler: stop model
 */
export function handleStopModel(item: ModelTreeItem, localProvider: LocalModelsProvider): void {
  if (item && (item.type === 'local-running' || item.type === 'cloud-running')) {
    void localProvider.stopModel(item.label);
  }
}

/**
 * Command handler: start cloud model
 */
export function handleStartCloudModel(item: ModelTreeItem, localProvider: LocalModelsProvider): void {
  if (item && item.type === 'cloud-stopped') {
    void localProvider.startModel(item.label);
  }
}

/**
 * Command handler: stop cloud model
 */
export function handleStopCloudModel(item: ModelTreeItem, localProvider: LocalModelsProvider): void {
  if (item && item.type === 'cloud-running') {
    void localProvider.stopModel(item.label);
  }
}

/**
 * Register sidebar with VS Code
 */
export function registerSidebar(context: ExtensionContext, client: Ollama, logChannel?: DiagnosticsLogger): void {
  const localProvider = new LocalModelsProvider(client, logChannel);
  const cloudProvider = new CloudModelsProvider(context, logChannel);
  const libraryProvider = new LibraryModelsProvider(() => cloudProvider.getCloudModelNamesForFilter(), logChannel);
  const previewProvider = new ModelPreviewViewProvider();

  const syncLibrarySortContext = () => {
    const mode = libraryProvider.getSortMode();
    void commands.executeCommand('setContext', 'ollama.librarySortMode', mode);
  };

  syncLibrarySortContext();

  logChannel?.info('[Ollama] Sidebar providers initialized');

  context.subscriptions.push(
    window.registerTreeDataProvider('ollama-local-models', localProvider),
    window.registerTreeDataProvider('ollama-library-models', libraryProvider),
    window.registerTreeDataProvider('ollama-cloud-models', cloudProvider),
    window.registerWebviewViewProvider('ollama-model-preview', previewProvider),
    commands.registerCommand('ollama-copilot.refreshSidebar', () => handleRefreshLocalModels(localProvider)),
    commands.registerCommand('ollama-copilot.refreshLocalModels', () => handleRefreshLocalModels(localProvider)),
    commands.registerCommand('ollama-copilot.refreshLibrary', () => handleRefreshLibrary(libraryProvider)),
    commands.registerCommand('ollama-copilot.refreshCloudModels', () => handleRefreshCloudModels(cloudProvider)),
    commands.registerCommand('ollama-copilot.sortLibraryByRecency', () =>
      handleSortLibraryByRecency(libraryProvider, syncLibrarySortContext),
    ),
    commands.registerCommand('ollama-copilot.sortLibraryByName', () =>
      handleSortLibraryByName(libraryProvider, syncLibrarySortContext),
    ),
    commands.registerCommand('ollama-copilot.manageCloudApiKey', async () =>
      handleManageCloudApiKey(context, cloudProvider, libraryProvider, logChannel),
    ),
    commands.registerCommand('ollama-copilot.openLibraryModel', (modelName: string) =>
      handleOpenLibraryModel(modelName),
    ),
    commands.registerCommand('ollama-copilot.openCloudModel', (modelName: string) => handleOpenCloudModel(modelName)),
    commands.registerCommand('ollama-copilot.deleteModel', (item: ModelTreeItem) =>
      handleDeleteModel(item, localProvider),
    ),
    commands.registerCommand('ollama-copilot.pullModel', async () =>
      handlePullModel(client, localProvider, logChannel),
    ),
    commands.registerCommand('ollama-copilot.pullModelFromLibrary', (item: ModelTreeItem) =>
      handlePullModelFromLibrary(item, client, localProvider, logChannel),
    ),
    commands.registerCommand('ollama-copilot.openLibraryModelPage', (item: ModelTreeItem) =>
      handleOpenLibraryModelPage(item),
    ),
    commands.registerCommand('ollama-copilot.showModelDetails', (item: ModelTreeItem) =>
      handleShowModelDetails(item, previewProvider),
    ),
    commands.registerCommand('ollama-copilot.previewLibraryModel', (item: ModelTreeItem) =>
      handlePreviewLibraryModel(item),
    ),
    commands.registerCommand('ollama-copilot.startModel', (item: ModelTreeItem) =>
      handleStartModel(item, localProvider),
    ),
    commands.registerCommand('ollama-copilot.stopModel', (item: ModelTreeItem) => handleStopModel(item, localProvider)),
    commands.registerCommand('ollama-copilot.startCloudModel', (item: ModelTreeItem) =>
      handleStartCloudModel(item, localProvider),
    ),
    commands.registerCommand('ollama-copilot.stopCloudModel', (item: ModelTreeItem) =>
      handleStopCloudModel(item, localProvider),
    ),
    { dispose: () => localProvider.dispose() },
    { dispose: () => libraryProvider.dispose() },
    { dispose: () => cloudProvider.dispose() },
  );
}
