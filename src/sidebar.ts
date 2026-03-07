import { Ollama } from 'ollama';
import {
  commands,
  Disposable,
  env,
  Event,
  EventEmitter,
  ExtensionContext,
  ProgressLocation,
  ThemeIcon,
  TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
  Uri,
  window,
  workspace,
} from 'vscode';
import { fetchModelCapabilities, getCloudOllamaClient, type ModelCapabilities } from './client.js';
import type { DiagnosticsLogger } from './diagnostics.js';

/**
 * Tree item representing a pane or model in the sidebar
 */
export class ModelTreeItem extends TreeItem {
  constructor(
    public readonly label: string,
    public readonly type:
      | 'model-group'
      | 'local-running'
      | 'local-stopped'
      | 'library-model'
      | 'library-model-variant'
      | 'library-model-downloaded-variant'
      | 'cloud-running'
      | 'cloud-stopped'
      | 'status',
    public readonly size?: number,
    public readonly durationMs?: number,
  ) {
    super(label);
    this.contextValue = type;
    this.collapsibleState = TreeItemCollapsibleState.None;

    if (type === 'model-group') {
      this.collapsibleState = TreeItemCollapsibleState.Collapsed;
    } else if (type === 'library-model') {
      this.collapsibleState = TreeItemCollapsibleState.Collapsed;
    }

    if (type === 'local-running' || type === 'cloud-running') {
      this.iconPath = createThemeIcon('play-circle');
    } else if (type === 'local-stopped' || type === 'cloud-stopped') {
      this.iconPath = createThemeIcon('stop-circle');
    } else if (type === 'library-model-downloaded-variant') {
      this.iconPath = createThemeIcon('check');
    }

    if (type === 'local-stopped' || type === 'cloud-stopped') {
      this.description = this.formatSize(size);
    } else if (type === 'local-running' || type === 'cloud-running') {
      const sizeStr = this.formatSize(size);
      const durationStr = this.formatDuration(durationMs);
      this.description = [sizeStr, durationStr].filter(Boolean).join(' • ');
    } else if (type === 'library-model-variant' || type === 'library-model-downloaded-variant') {
      this.description = this.formatSize(size);
    }
  }

  private formatSize(bytes?: number): string {
    if (!bytes) return '';
    if (bytes < 1024 ** 2) {
      return Math.round(bytes / 1024) + ' KB';
    }
    if (bytes < 1024 ** 3) {
      return Math.round(bytes / 1024 ** 2) + ' MB';
    }
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

function createThemeIcon(id: string): ThemeIcon {
  // The bundled `vscode` typings in this repo mark the constructor private,
  // but VS Code runtime supports codicon IDs for TreeItem ThemeIcon values.
  const ThemeIconCtor = ThemeIcon as unknown as { new (iconId: string): ThemeIcon };
  return new ThemeIconCtor(id);
}

/**
 * Extract the base model family name from a full model name.
 * Examples:
 *   phi3, phi3.5, phi4 → phi
 *   deepseek-v3.1, deepseek-v3.2 → deepseek
 *   llama2, llama3 → llama
 *   qwen:7b → qwen
 */
function extractModelFamily(modelName: string): string {
  // Remove everything after colon if present
  const baseName = modelName.split(':')[0];

  // Any dashed family/variant naming (command-r, deepseek-v3.2) groups by prefix.
  const firstDash = baseName.indexOf('-');
  if (firstDash > 0) {
    const prefix = baseName.slice(0, firstDash);
    // Normalize numeric family prefixes (qwen3 -> qwen, qwen3.5 -> qwen)
    const normalizedPrefix = prefix.replace(/[\d.]+$/, '');
    return normalizedPrefix || prefix;
  }

  // Trailing numeric version naming (phi3.5, llama2) groups by alpha prefix.
  const withoutTrailingVersion = baseName.replace(/[\d.]+$/, '');
  if (withoutTrailingVersion && withoutTrailingVersion !== baseName) {
    return withoutTrailingVersion;
  }

  // Embedded numeric version naming without dash (qwen2.5vl, qwen2math)
  // should also group by the leading alpha family token.
  const embeddedVersionMatch = /^([a-z]+)[\d.]+[a-z0-9]*$/i.exec(baseName);
  if (embeddedVersionMatch?.[1]) {
    return embeddedVersionMatch[1].toLowerCase();
  }

  // No pattern matched, return the base name as-is
  return baseName;
}

/**
 * Group models by their family name
 */
function groupModelsByFamily(models: ModelTreeItem[]): Map<string, ModelTreeItem[]> {
  const groups = new Map<string, ModelTreeItem[]>();

  for (const model of models) {
    const family = extractModelFamily(model.label);
    if (!groups.has(family)) {
      groups.set(family, []);
    }
    groups.get(family)!.push(model);
  }

  return groups;
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

/**
 * Local models view provider (installed + running state)
 */
export class LocalModelsProvider implements TreeDataProvider<ModelTreeItem>, Disposable {
  private treeChangeEmitter = new EventEmitter<ModelTreeItem | null>();
  readonly onDidChangeTreeData: Event<ModelTreeItem | null> = this.treeChangeEmitter.event;

  filterText = '';
  grouped = true;

  private refreshIntervals: NodeJS.Timeout[] = [];
  private localModelCapabilitiesCache = new Map<string, ModelCapabilities>();
  private localModelCapabilitiesInFlight = new Set<string>();
  private cachedLocalModelNames = new Set<string>();

  constructor(
    private client: Ollama,
    private context?: ExtensionContext,
    private logChannel?: DiagnosticsLogger,
    private onLocalModelsChanged?: () => void,
  ) {
    this.startAutoRefresh();
  }

  /**
   * Get tree items for a given element
   */
  async getChildren(element?: ModelTreeItem): Promise<ModelTreeItem[]> {
    if (!element) {
      // Top level: get local models and group by family
      const models = await this.getLocalModels();
      if (models.length === 0) {
        return [makeStatusItem('No local models')];
      }

      if (models.every(model => model.type === 'status')) {
        return models;
      }

      // Flat mode: return all models sorted A-Z
      if (!this.grouped) {
        const filterLower = this.filterText.toLowerCase();
        return models
          .filter(m => m.type !== 'status' && (!filterLower || m.label.toLowerCase().includes(filterLower)))
          .sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()));
      }

      // Group models by family
      const groups = groupModelsByFamily(models);

      // Apply filter: keep only families where the family name or any child matches
      const filterLower = this.filterText.toLowerCase();
      const filteredEntries = Array.from(groups.entries())
        .filter(([familyName, familyModels]) =>
          !filterLower ||
          familyName.toLowerCase().includes(filterLower) ||
          familyModels.some(m => m.label.toLowerCase().includes(filterLower)),
        )
        .sort((a, b) => a[0].localeCompare(b[0]));

      // Always create explicit family parent groups.
      const result: ModelTreeItem[] = [];
      for (const [familyName, familyModels] of filteredEntries) {
        const groupItem = new ModelTreeItem(familyName, 'model-group');
        groupItem.tooltip = `${familyName} family (${familyModels.length} models)`;
        result.push(groupItem);
      }
      return result;
    }

    // Child level: if element is a model-group, return its models
    if (element.type === 'model-group') {
      const models = await this.getLocalModels();
      return models
        .filter(m => extractModelFamily(m.label) === element.label)
        .sort((a, b) => a.label.localeCompare(b.label));
    }

    return [];
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

      const visibleLocalModels = listResponse.models.filter(model => !this.isCloudTaggedModel(model.name));

      const items = visibleLocalModels
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
          // Fetch tooltip description asynchronously
          void fetchModelPagePreview(model.name).then(
            preview => {
              item.tooltip = buildLocalModelTooltip(model.name, model.size, running, preview.description);
              this.treeChangeEmitter.fire(item);
            },
            () => {
              // Keep initial tooltip on error
            },
          );

          const appendBadges = (caps: ModelCapabilities) => {
            const badges: string[] = [];
            if (caps.toolCalling) badges.push('tools');
            if (caps.imageInput) badges.push('vision');
            if (badges.length === 0) {
              return;
            }

            const badgeStr = badges.map(b => `[${b}]`).join(' ');
            const existing = (item.description ?? '').toString();
            const knownBadgePattern = badges.map(b => `\\[${b}\\]`).join('|');
            const stripRe = new RegExp(`\\s*(${knownBadgePattern})(\\s*(${knownBadgePattern}))*\\s*$`, 'i');
            const cleaned = existing.replace(stripRe, '').trim();
            item.description = cleaned ? `${cleaned} ${badgeStr}` : badgeStr;
          };

          const cachedCaps = this.localModelCapabilitiesCache.get(model.name);
          if (cachedCaps) {
            appendBadges(cachedCaps);
          } else if (!this.localModelCapabilitiesInFlight.has(model.name)) {
            this.localModelCapabilitiesInFlight.add(model.name);
            // Fetch capabilities once per local model name.
            void fetchModelCapabilities(this.client, model.name)
              .then(caps => {
                this.localModelCapabilitiesCache.set(model.name, caps);
                appendBadges(caps);
                this.treeChangeEmitter.fire(item);
              })
              .catch(() => {
                // Silently skip badges on error
              })
              .finally(() => {
                this.localModelCapabilitiesInFlight.delete(model.name);
              });
          }

          return item;
        })
        .sort((a, b) => {
          return a.label.localeCompare(b.label);
        });

      this.logChannel?.info(
        `[Ollama] Local models loaded: ${items.length} total, ${items.filter(m => m.type === 'local-running').length} running`,
      );

      this.cachedLocalModelNames = new Set(visibleLocalModels.map(m => m.name));
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
    this.onLocalModelsChanged?.();
  }

  /**
   * Get the cached set of locally installed model names (populated after each fetch)
   */
  getCachedLocalModelNames(): Set<string> {
    return new Set(this.cachedLocalModelNames);
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
        const isCloudModel = this.isCloudTaggedModel(modelName);
        const activeClient = (isCloudModel && this.context) ? await getCloudOllamaClient(this.context) : this.client;
        if (isCloudModel) {
          // Cloud models should be pulled first (same behavior as `ollama run`).
          this.logChannel?.info(`[Ollama] Pulling cloud model before start: ${modelName}`);
          await activeClient.pull({ model: modelName, stream: false });
        }
        await activeClient.generate({ model: modelName, prompt: '', stream: false, keep_alive: '10m' });

        let running = false;
        try {
          const { models } = await this.client.ps();
          running = models.some(m => m.name === modelName);
        } catch {
          // If ps() fails, fall back to optimistic status messaging below.
        }

        if (running) {
          this.logChannel?.info(`[Ollama] Model started: ${modelName}`);
        } else if (isCloudModel) {
          this.logChannel?.info(`[Ollama] Cloud model warmed but not persistent in /api/ps: ${modelName}`);
        } else {
          this.logChannel?.warn(`[Ollama] Model warm-up completed but not shown as running: ${modelName}`);
        }

        this.refresh();
        if (running) {
          window.showInformationMessage(`Model ${modelName} started`);
        } else if (isCloudModel) {
          window.showInformationMessage(
            `Model ${modelName} is ready. Cloud models may not appear as running until actively used.`,
          );
        } else {
          window.showWarningMessage(`Model ${modelName} warmed up, but is not shown as running.`);
        }
      });
    } catch (error) {
      this.logChannel?.exception(`[Ollama] Failed to start model ${modelName}`, error);
      const msg = error instanceof Error ? error.message : 'Unknown error';
      window.showErrorMessage(`Failed to start model: ${msg}`);
    }
  }

  private isCloudTaggedModel(modelName: string): boolean {
    const tag = modelName.split(':')[1] ?? '';
    return tag === 'cloud' || tag.endsWith('-cloud');
  }

  /**
   * Stop a running model and show a progress indicator until it is fully unloaded
   */
  async stopModel(modelName: string): Promise<void> {
    try {
      this.logChannel?.debug(`[Ollama] Stopping model: ${modelName}`);
      await window.withProgress(
        { location: ProgressLocation.Notification, title: `Stopping ${modelName}…`, cancellable: false },
        async () => {
          await this.client.generate({ model: modelName, prompt: '', stream: false, keep_alive: 0 });
          // Poll until the model disappears from the running process list (max 30 s)
          for (let i = 0; i < 30; i++) {
            await new Promise<void>(resolve => setTimeout(resolve, 1000));
            try {
              const { models } = await this.client.ps();
              if (!models.some(m => m.name === modelName)) break;
            } catch {
              break; // ps() failed — assume model is gone
            }
          }
        },
      );
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

/** Raw scraped metadata for a single library model variant. */
type VariantRaw = { name: string; size?: number };

/**
 * Remote library models view provider
 */
export class LibraryModelsProvider implements TreeDataProvider<ModelTreeItem>, Disposable {
  private treeChangeEmitter = new EventEmitter<ModelTreeItem | null>();
  readonly onDidChangeTreeData: Event<ModelTreeItem | null> = this.treeChangeEmitter.event;

  filterText = '';
  grouped = true;

  private cache: string[] = [];
  private cacheTimeMs = 0;
  private cacheGeneration = 0;
  private refreshTimeout: NodeJS.Timeout | null = null;
  private refreshIntervals: NodeJS.Timeout[] = [];
  private loadPromise: Promise<string[]> | null = null;
  /** Caches raw variant metadata (names + sizes) only — not materialized tree items. */
  private variantsCache = new Map<string, VariantRaw[]>();
  private localProvider?: LocalModelsProvider;

  constructor(private logChannel?: DiagnosticsLogger) {
    this.startAutoRefresh();
  }

  setLocalProvider(provider: LocalModelsProvider): void {
    this.localProvider = provider;
  }

  private getLocalModelNames(): Set<string> {
    return this.localProvider?.getCachedLocalModelNames() ?? new Set();
  }

  getTreeItem(element: ModelTreeItem): TreeItem {
    return element;
  }

  async getChildren(element?: ModelTreeItem): Promise<ModelTreeItem[]> {
    if (element?.type === 'library-model') {
      let raw = this.variantsCache.get(element.label);
      if (!raw) {
        const fetched = await this.fetchModelVariants(element.label);
        if (fetched === null) {
          return [makeStatusItem('Failed to load variants')];
        }
        if (fetched.length === 0) {
          return [makeStatusItem('No variants found')];
        }
        this.variantsCache.set(element.label, fetched);
        raw = fetched;
      }
      if (raw.length === 0) {
        return [makeStatusItem('No variants found')];
      }
      // Re-materialize on every call so check icons reflect current local state.
      return this.materializeVariants(raw, this.getLocalModelNames());
    }

    if (element?.type === 'model-group') {
      // Expanding a family group: show its library models.
      // If the group has exactly one model with the same name, skip the
      // redundant middle parent and show variants directly.
      const models = await this.getLibraryModels();
      const groupedModels = models
        .filter(m => extractModelFamily(m.label) === element.label)
        .sort((a, b) => a.label.localeCompare(b.label));

      if (groupedModels.length === 1 && groupedModels[0].label === element.label) {
        let raw = this.variantsCache.get(groupedModels[0].label);
        if (!raw) {
          const fetched = await this.fetchModelVariants(groupedModels[0].label);
          if (fetched === null) {
            return [makeStatusItem('Failed to load variants')];
          }
          if (fetched.length === 0) {
            return [makeStatusItem('No variants found')];
          }
          this.variantsCache.set(groupedModels[0].label, fetched);
          raw = fetched;
        }
        if (raw.length === 0) {
          return [makeStatusItem('No variants found')];
        }
        return this.materializeVariants(raw, this.getLocalModelNames());
      }

      return groupedModels;
    }

    if (element) {
      return [];
    }

    // Top level: display library list grouped by family
    const models = await this.getLibraryModels();
    if (models.length === 0) {
      return [makeStatusItem('No library models found')];
    }

    if (models.every(model => model.type === 'status')) {
      return models;
    }

    // Flat mode: return all library models sorted A-Z
    if (!this.grouped) {
      const filterLower = this.filterText.toLowerCase();
      return models
        .filter(m => m.type !== 'status' && (!filterLower || m.label.toLowerCase().includes(filterLower)))
        .sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()));
    }

    // Group models by family
    const groups = groupModelsByFamily(models);

    // Apply filter: keep only families where the family name or any child matches
    const filterLower = this.filterText.toLowerCase();
    const filteredEntries = Array.from(groups.entries())
      .filter(([familyName, familyModels]) =>
        !filterLower ||
        familyName.toLowerCase().includes(filterLower) ||
        familyModels.some(m => m.label.toLowerCase().includes(filterLower)),
      )
      .sort((a, b) => a[0].localeCompare(b[0]));

    // Always create explicit family parent groups.
    const result: ModelTreeItem[] = [];
    for (const [familyName, familyModels] of filteredEntries) {
      const groupItem = new ModelTreeItem(familyName, 'model-group');
      groupItem.tooltip = `${familyName} family (${familyModels.length} models)`;
      result.push(groupItem);
    }
    return result;
  }

  refresh(): void {
    this.cache = [];
    this.cacheTimeMs = 0;
    this.loadPromise = null;
    this.variantsCache.clear();
    this.cacheGeneration++;
    this.treeChangeEmitter.fire(null);
  }

  /**
   * Notify VS Code that variant check-icons may be stale (e.g. after a local
   * model is pulled or deleted). Raw variant metadata is preserved; items are
   * re-materialized from the current local model set on the next getChildren call.
   */
  refreshVariantStates(): void {
    this.treeChangeEmitter.fire(null);
  }

  private materializeVariants(raw: VariantRaw[], localNames: Set<string>): ModelTreeItem[] {
    return raw.map(({ name, size }) => {
      const isDownloaded = localNames.has(name);
      const item = new ModelTreeItem(
        name,
        isDownloaded ? 'library-model-downloaded-variant' : 'library-model-variant',
        size,
      );
      item.tooltip = name;
      return item;
    });
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

    const gen = this.cacheGeneration;
    this.loadPromise = this.fetchLibraryModelNames(12000)
      .then(names => {
        if (this.cacheGeneration === gen) {
          this.cache = names;
          this.cacheTimeMs = Date.now();
        }
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
    const url = 'https://ollama.com/library';

    try {
      const response = await fetch(url, {
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

      const filteredNames = parsedNames.filter(name => {
        const normalized = name.toLowerCase();
        if (normalized.startsWith('cloud/')) {
          return false;
        }
        if (normalized.includes('/cloud/')) {
          return false;
        }
        // Exclude variant-style names (e.g., llama3.2:1b) from the top-level list
        if (normalized.includes(':')) {
          return false;
        }
        return true;
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
      item.tooltip = `Library model: ${name}`;
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
      return item;
    });

    return items.length > 0 ? items : [makeStatusItem('No library models found')];
  }

  private sortNames(names: string[]): string[] {
    return [...names].sort((a, b) => a.localeCompare(b));
  }

  private async fetchModelVariants(modelName: string): Promise<VariantRaw[] | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const url = getLibraryModelUrl(modelName);

    try {
      const response = await fetch(url, { method: 'GET', signal: controller.signal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const html = await response.text();
      const escapedName = modelName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      // Build a size map by parsing the mobile-layout (sm:hidden) anchor blocks,
      // which each contain a size string like "1.3GB" or "780MB".
      const sizeMap = new Map<string, number>();
      const blockPattern = new RegExp(
        `href="/library/(${escapedName}:[^"?#]+)"[^>]*class="[^"]*sm:hidden[^"]*"[^>]*>([\\s\\S]*?)</a>`,
        'g',
      );
      for (const m of html.matchAll(blockPattern)) {
        const name = typeof m[1] === 'string' ? decodeURIComponent(m[1]).trim() : '';
        const sizeMatch = /(\d+(?:\.\d+)?)\s*(GB|MB|KB)/i.exec(m[2] ?? '');
        if (name && sizeMatch) {
          const value = parseFloat(sizeMatch[1]);
          const unit = sizeMatch[2].toUpperCase();
          if (unit === 'GB') sizeMap.set(name, Math.round(value * 1024 ** 3));
          else if (unit === 'MB') sizeMap.set(name, Math.round(value * 1024 ** 2));
          else sizeMap.set(name, Math.round(value * 1024));
        }
      }

      const variantPattern = new RegExp(`href="/library/(${escapedName}:[^"?#]+)"`, 'g');
      const matches = [...html.matchAll(variantPattern)];
      const variantNames = [
        ...new Set(matches.map(m => (typeof m[1] === 'string' ? decodeURIComponent(m[1]).trim() : '')).filter(Boolean)),
      ];

      return variantNames.map(name => ({ name, size: sizeMap.get(name) }));
    } catch (error) {
      this.logChannel?.exception('[Ollama] Failed to fetch model variants', error);
      return null;
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

  filterText = '';
  grouped = true;

  private cache: ModelTreeItem[] = [];
  private cacheTimeMs = 0;
  private loadPromise: Promise<ModelTreeItem[]> | null = null;
  private refreshIntervals: NodeJS.Timeout[] = [];
  private cachedNames = new Set<string>();
  private warmedModelNames = new Set<string>();
  private warmedModelResolvedNames = new Map<string, string>();

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
    if (!element) {
      // Top level: get cloud models and group by family
      const models = await this.getCloudModels();

      // If it's a status message, return as-is
      if (models.length === 1 && models[0].type === 'status') {
        return models;
      }

      if (models.length === 0) {
        return [makeStatusItem('No cloud models found')];
      }

      // Flat mode: return all cloud models sorted A-Z
      if (!this.grouped) {
        const filterLower = this.filterText.toLowerCase();
        return models
          .filter(m => m.type !== 'status' && (!filterLower || m.label.toLowerCase().includes(filterLower)))
          .sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()));
      }

      // Group models by family
      const groups = groupModelsByFamily(models);

      // Apply filter: keep only families where the family name or any child matches
      const filterLower = this.filterText.toLowerCase();
      const filteredEntries = Array.from(groups.entries())
        .filter(([familyName, familyModels]) =>
          !filterLower ||
          familyName.toLowerCase().includes(filterLower) ||
          familyModels.some(m => m.label.toLowerCase().includes(filterLower)),
        )
        .sort((a, b) => a[0].localeCompare(b[0]));

      // Always create explicit family parent groups.
      const result: ModelTreeItem[] = [];
      for (const [familyName, familyModels] of filteredEntries) {
        const groupItem = new ModelTreeItem(familyName, 'model-group');
        groupItem.tooltip = `${familyName} family (${familyModels.length} models)`;
        result.push(groupItem);
      }
      return result;
    }

    // Child level: if element is a model-group, return its models
    if (element.type === 'model-group') {
      const allModels = await this.getCloudModels();
      return allModels
        .filter(m => m.type !== 'status' && extractModelFamily(m.label) === element.label)
        .sort((a, b) => a.label.localeCompare(b.label));
    }

    return [];
  }

  refresh(): void {
    this.cache = [];
    this.cacheTimeMs = 0;
    this.treeChangeEmitter.fire(null);
  }

  getCachedModelNames(): Set<string> {
    return new Set(this.cachedNames);
  }

  markModelWarm(modelName: string, resolvedName?: string): void {
    const baseName = modelName.split(':')[0];
    this.warmedModelNames.add(baseName);
    if (resolvedName) {
      this.warmedModelResolvedNames.set(baseName, resolvedName);
    }
    this.treeChangeEmitter.fire(null);
  }

  getWarmedModelName(baseName: string): string {
    const base = baseName.split(':')[0];
    return this.warmedModelResolvedNames.get(base) ?? `${base}:cloud`;
  }

  markModelStopped(modelName: string): void {
    const baseName = modelName.split(':')[0];
    this.warmedModelNames.delete(baseName);
    this.warmedModelResolvedNames.delete(baseName);
    this.treeChangeEmitter.fire(null);
  }

  async getCloudModelNamesForFilter(): Promise<Set<string>> {
    try {
      await this.getCloudModels();
      return new Set(this.cachedNames);
    } catch {
      return new Set();
    }
  }

  async resolveRunnableCloudModelName(modelName: string): Promise<string> {
    if (modelName.includes(':')) {
      return modelName;
    }

    const available = await this.getCloudModelNamesForFilter();
    const exactCloud = `${modelName}:cloud`;
    if (available.has(exactCloud)) {
      return exactCloud;
    }

    const candidates = [...available].filter(name => {
      if (!name.startsWith(`${modelName}:`)) {
        return false;
      }
      const tag = name.split(':')[1] ?? '';
      return tag === 'cloud' || tag.endsWith('-cloud');
    });

    if (candidates.length > 0) {
      candidates.sort((a, b) => a.localeCompare(b));
      return candidates[0];
    }

    // Fallback: inspect the model page for explicit cloud tags.
    const escapedName = modelName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(getLibraryModelUrl(modelName), {
        method: 'GET',
        signal: controller.signal,
      });

      if (response.ok) {
        const html = await response.text();
        const tagMatches = [
          ...html.matchAll(new RegExp(`href="/library/(${escapedName}:(?:cloud|[^"?#]*-cloud))"`, 'gi')),
        ];
        const tagNames = [
          ...new Set(
            tagMatches
              .map(match => (typeof match[1] === 'string' ? decodeURIComponent(match[1]).trim() : ''))
              .filter(Boolean),
          ),
        ];

        const preferredCloud = tagNames.find(name => name.endsWith(':cloud'));
        if (preferredCloud) {
          return preferredCloud;
        }

        if (tagNames.length > 0) {
          tagNames.sort((a, b) => a.localeCompare(b));
          return tagNames[0];
        }
      }
    } catch {
      // Ignore and use final fallback below.
    } finally {
      clearTimeout(timeout);
    }

    return `${modelName}:cloud`;
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
      // Fetch running status and cloud catalog concurrently to minimize latency
      const [statusResponse, libraryResponse] = await Promise.all([
        fetch('https://ollama.com/api/tags', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: 'application/json',
          },
          signal: controller.signal,
        }),
        fetch('https://ollama.com/search?c=cloud', {
          method: 'GET',
          signal: controller.signal,
        }),
      ]);

      if (!statusResponse.ok) {
        throw new Error(`HTTP ${statusResponse.status} from cloud models endpoint`);
      }

      if (!libraryResponse.ok) {
        throw new Error(`HTTP ${libraryResponse.status} from library`);
      }

      const [statusJson, html] = await Promise.all([
        statusResponse.json() as Promise<{ models?: Array<{ name: string; size?: number; expires_at?: string }> }>,
        libraryResponse.text(),
      ]);

      // Build map of running models (API returns base names)
      const runningModels = new Map<string, { durationMs?: number; size?: number }>();
      for (const model of statusJson.models ?? []) {
        const baseName = model.name.split(':')[0];
        const durationMs = model.expires_at
          ? Math.max(0, new Date(model.expires_at).getTime() - Date.now())
          : undefined;
        runningModels.set(baseName, { durationMs, size: model.size });
      }

      // Parse cloud model families from catalog links.
      const cloudMatches = [...html.matchAll(/href="\/library\/([^"?#:]+)"/gi)];

      const cloudModelNames = [
        ...new Set(
          cloudMatches
            .map(match => (typeof match[1] === 'string' ? decodeURIComponent(match[1]).trim() : ''))
            .filter(Boolean),
        ),
      ];

      const items = cloudModelNames
        .map(fullName => {
          const baseName = fullName.split(':')[0];
          const runningInfo = runningModels.get(baseName);
          const isRunning =
            (typeof runningInfo?.durationMs === 'number' && runningInfo.durationMs > 0) ||
            this.warmedModelNames.has(baseName);
          const item = new ModelTreeItem(
            fullName,
            isRunning ? 'cloud-running' : 'cloud-stopped',
            runningInfo?.size,
            runningInfo?.durationMs,
          );
          item.tooltip = `Cloud model: ${fullName}`;
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
    prompt: existing ? 'Update Ollama Cloud API key' : 'Enter Ollama Cloud API key',
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
 * Command handler: open cloud model page
 */
export function handleOpenCloudModel(item: ModelTreeItem): void {
  if (item && (item.type === 'cloud-running' || item.type === 'cloud-stopped')) {
    void env.openExternal(Uri.parse(getLibraryModelUrl(item.label)));
  }
}

/**
 * Command handler: delete model
 */
export async function handleDeleteModel(item: ModelTreeItem, localProvider: LocalModelsProvider): Promise<void> {
  if (item && (item.type === 'local-running' || item.type === 'cloud-running')) {
    void window.showErrorMessage('Stop the model before deleting it.');
    return;
  }
  if (
    item &&
    (item.type === 'local-stopped' ||
      item.type === 'cloud-stopped')
  ) {
    const answer = await window.showWarningMessage(`Delete model "${item.label}"?`, 'Delete', 'Cancel');
    if (answer === 'Delete') {
      void localProvider.deleteModel(item.label);
    }
  }
}

/**
 * Stream a model pull, reporting progress to VS Code's notification system.
 */
async function pullModelWithProgress(
  client: Ollama,
  modelName: string,
  localProvider: LocalModelsProvider,
  logChannel?: DiagnosticsLogger,
): Promise<void> {
  await window.withProgress(
    { location: ProgressLocation.Notification, title: `Pulling ${modelName}`, cancellable: true },
    async (progress, token) => {
      token.onCancellationRequested(() => {
        client.abort();
      });

      try {
        const stream = await client.pull({ model: modelName, stream: true });
        let lastCompleted = 0;
        let lastTotal = 0;

        for await (const chunk of stream) {
          const total = chunk.total ?? 0;
          const completed = chunk.completed ?? 0;

          if (total > 0) {
            // Handle potential reset of completed while total stays the same (per-layer streaming).
            if (total === lastTotal && completed < lastCompleted) {
              lastCompleted = 0;
            }

            const pct = Math.round((completed / total) * 100);
            const completedMb = (completed / 1024 / 1024).toFixed(1);
            const totalMb = (total / 1024 / 1024).toFixed(1);

            let increment = 0;
            if (total === lastTotal && lastCompleted > 0) {
              const deltaCompleted = completed - lastCompleted;
              if (deltaCompleted > 0) {
                increment = Math.round((deltaCompleted / total) * 100);
              }
            }
            progress.report({ message: `${pct}% (${completedMb} / ${totalMb} MB)`, increment });
            lastCompleted = completed;
            lastTotal = total;
          } else if (chunk.status) {
            progress.report({ message: chunk.status });
          }
        }

        logChannel?.info(`[Ollama] Model pulled successfully: ${modelName}`);
        localProvider.refresh();
        window.showInformationMessage(`Model ${modelName} pulled successfully`);
      } catch (error) {
        if (token.isCancellationRequested) {
          window.showInformationMessage(`Download of ${modelName} cancelled`);
          return;
        }
        logChannel?.exception?.(`[Ollama] Failed to pull model ${modelName}`, error);
        const msg = error instanceof Error ? error.message : String(error);
        window.showErrorMessage(`Failed to pull model: ${msg}`);
      }
    },
  );
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
    await pullModelWithProgress(client, modelName, localProvider, logChannel);
  }
}

/**
 * Command handler: pull model from library
 */
export async function handlePullModelFromLibrary(
  item: ModelTreeItem,
  client: Ollama,
  localProvider: LocalModelsProvider,
  logChannel?: DiagnosticsLogger,
): Promise<void> {
  if (item && (item.type === 'library-model-variant' || item.type === 'library-model-downloaded-variant')) {
    await pullModelWithProgress(client, item.label, localProvider, logChannel);
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
export async function handleStartCloudModel(
  item: ModelTreeItem,
  localProvider: LocalModelsProvider,
  cloudProvider?: CloudModelsProvider,
): Promise<void> {
  if (item && item.type === 'cloud-stopped') {
    const resolvedModel = cloudProvider
      ? await cloudProvider.resolveRunnableCloudModelName(item.label)
      : item.label.includes(':')
        ? item.label
        : `${item.label}:cloud`;
    await localProvider.startModel(resolvedModel);
    cloudProvider?.markModelWarm(item.label, resolvedModel);
    cloudProvider?.refresh();
  }
}

/**
 * Command handler: stop cloud model
 */
export async function handleStopCloudModel(
  item: ModelTreeItem,
  localProvider: LocalModelsProvider,
  cloudProvider?: CloudModelsProvider,
): Promise<void> {
  if (item && item.type === 'cloud-running') {
    const resolvedName = cloudProvider?.getWarmedModelName(item.label) ?? item.label;
    await localProvider.stopModel(resolvedName);
    cloudProvider?.markModelStopped(item.label);
    cloudProvider?.refresh();
  }
}

/**
 * Register sidebar with VS Code
 */
export function registerSidebar(
  context: ExtensionContext,
  client: Ollama,
  logChannel?: DiagnosticsLogger,
  onLocalModelsChanged?: () => void,
): void {
  let libraryProvider: LibraryModelsProvider | undefined;
  const localProvider = new LocalModelsProvider(client, context, logChannel, () => {
    onLocalModelsChanged?.();
    libraryProvider?.refreshVariantStates();
  });
  const cloudProvider = new CloudModelsProvider(context, logChannel);
  libraryProvider = new LibraryModelsProvider(logChannel);
  libraryProvider.setLocalProvider(localProvider);

  logChannel?.info('[Ollama] Sidebar providers initialized');

  const localTreeView = window.createTreeView('ollama-local-models', { treeDataProvider: localProvider });
  const libraryTreeView = window.createTreeView('ollama-library-models', { treeDataProvider: libraryProvider });
  const cloudTreeView = window.createTreeView('ollama-cloud-models', { treeDataProvider: cloudProvider });

  context.subscriptions.push(
    localTreeView,
    libraryTreeView,
    cloudTreeView,
    commands.registerCommand('ollama-copilot.collapseLocalModels', () =>
      commands.executeCommand('workbench.actions.treeView.ollama-local-models.collapseAll'),
    ),
    commands.registerCommand('ollama-copilot.collapseCloudModels', () =>
      commands.executeCommand('workbench.actions.treeView.ollama-cloud-models.collapseAll'),
    ),
    commands.registerCommand('ollama-copilot.collapseLibrary', () =>
      commands.executeCommand('workbench.actions.treeView.ollama-library-models.collapseAll'),
    ),
    commands.registerCommand('ollama-copilot.filterLocalModels', async () => {
      const value = await window.showInputBox({ prompt: 'Filter local models', value: localProvider.filterText });
      if (value !== undefined) {
        localProvider.filterText = value;
        void commands.executeCommand('setContext', 'ollama.localFilterActive', value.length > 0);
        localProvider.refresh();
      }
    }),
    commands.registerCommand('ollama-copilot.clearLocalFilter', () => {
      localProvider.filterText = '';
      void commands.executeCommand('setContext', 'ollama.localFilterActive', false);
      localProvider.refresh();
    }),
    commands.registerCommand('ollama-copilot.filterCloudModels', async () => {
      const value = await window.showInputBox({ prompt: 'Filter cloud models', value: cloudProvider.filterText });
      if (value !== undefined) {
        cloudProvider.filterText = value;
        void commands.executeCommand('setContext', 'ollama.cloudFilterActive', value.length > 0);
        cloudProvider.refresh();
      }
    }),
    commands.registerCommand('ollama-copilot.clearCloudFilter', () => {
      cloudProvider.filterText = '';
      void commands.executeCommand('setContext', 'ollama.cloudFilterActive', false);
      cloudProvider.refresh();
    }),
    commands.registerCommand('ollama-copilot.filterLibraryModels', async () => {
      const value = await window.showInputBox({ prompt: 'Filter library models', value: libraryProvider.filterText });
      if (value !== undefined) {
        libraryProvider.filterText = value;
        void commands.executeCommand('setContext', 'ollama.libraryFilterActive', value.length > 0);
        libraryProvider.refresh();
      }
    }),
    commands.registerCommand('ollama-copilot.clearLibraryFilter', () => {
      libraryProvider.filterText = '';
      void commands.executeCommand('setContext', 'ollama.libraryFilterActive', false);
      libraryProvider.refresh();
    }),
    (() => {
      const initialLocalGrouped = context.globalState.get<boolean>('ollama.localGrouped', true);
      localProvider.grouped = initialLocalGrouped;
      void commands.executeCommand('setContext', 'ollama.localGrouped', initialLocalGrouped);
      return commands.registerCommand('ollama-copilot.toggleLocalGrouping', () => {
        localProvider.grouped = !localProvider.grouped;
        void context.globalState.update('ollama.localGrouped', localProvider.grouped);
        void commands.executeCommand('setContext', 'ollama.localGrouped', localProvider.grouped);
        localProvider.refresh();
      });
    })(),
    (() => {
      const initialCloudGrouped = context.globalState.get<boolean>('ollama.cloudGrouped', true);
      cloudProvider.grouped = initialCloudGrouped;
      void commands.executeCommand('setContext', 'ollama.cloudGrouped', initialCloudGrouped);
      return commands.registerCommand('ollama-copilot.toggleCloudGrouping', () => {
        cloudProvider.grouped = !cloudProvider.grouped;
        void context.globalState.update('ollama.cloudGrouped', cloudProvider.grouped);
        void commands.executeCommand('setContext', 'ollama.cloudGrouped', cloudProvider.grouped);
        cloudProvider.refresh();
      });
    })(),
    (() => {
      const initialLibraryGrouped = context.globalState.get<boolean>('ollama.libraryGrouped', true);
      libraryProvider.grouped = initialLibraryGrouped;
      void commands.executeCommand('setContext', 'ollama.libraryGrouped', initialLibraryGrouped);
      return commands.registerCommand('ollama-copilot.toggleLibraryGrouping', () => {
        libraryProvider.grouped = !libraryProvider.grouped;
        void context.globalState.update('ollama.libraryGrouped', libraryProvider.grouped);
        void commands.executeCommand('setContext', 'ollama.libraryGrouped', libraryProvider.grouped);
        libraryProvider.refresh();
      });
    })(),
    commands.registerCommand('ollama-copilot.refreshSidebar', () => handleRefreshLocalModels(localProvider)),
    commands.registerCommand('ollama-copilot.refreshLocalModels', () => handleRefreshLocalModels(localProvider)),
    commands.registerCommand('ollama-copilot.refreshLibrary', () => handleRefreshLibrary(libraryProvider)),
    commands.registerCommand('ollama-copilot.refreshCloudModels', () => handleRefreshCloudModels(cloudProvider)),
    commands.registerCommand('ollama-copilot.manageCloudApiKey', async () =>
      handleManageCloudApiKey(context, cloudProvider, libraryProvider, logChannel),
    ),
    commands.registerCommand('ollama-copilot.openCloudModel', (item: ModelTreeItem) => handleOpenCloudModel(item)),
    commands.registerCommand('ollama-copilot.deleteModel', (item: ModelTreeItem) =>
      handleDeleteModel(item, localProvider),
    ),
    commands.registerCommand('ollama-copilot.pullModel', async () =>
      handlePullModel(client, localProvider, logChannel),
    ),
    commands.registerCommand('ollama-copilot.pullModelFromLibrary', async (item: ModelTreeItem) =>
      handlePullModelFromLibrary(item, client, localProvider, logChannel),
    ),
    commands.registerCommand('ollama-copilot.openLibraryModelPage', (item: ModelTreeItem) =>
      handleOpenLibraryModelPage(item),
    ),
    commands.registerCommand('ollama-copilot.startModel', (item: ModelTreeItem) =>
      handleStartModel(item, localProvider),
    ),
    commands.registerCommand('ollama-copilot.stopModel', (item: ModelTreeItem) => handleStopModel(item, localProvider)),
    commands.registerCommand('ollama-copilot.startCloudModel', (item: ModelTreeItem) =>
      handleStartCloudModel(item, localProvider, cloudProvider),
    ),
    commands.registerCommand('ollama-copilot.stopCloudModel', (item: ModelTreeItem) =>
      handleStopCloudModel(item, localProvider, cloudProvider),
    ),
    { dispose: () => localProvider.dispose() },
    { dispose: () => libraryProvider.dispose() },
    { dispose: () => cloudProvider.dispose() },
  );
}
