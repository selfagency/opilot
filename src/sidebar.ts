import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir, totalmem } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Ollama } from 'ollama';
import {
  CancellationToken,
  commands,
  Disposable,
  env,
  Event,
  EventEmitter,
  ExtensionContext,
  Progress,
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
import { reportError } from './errorHandler.js';
import { isThinkingModelId } from './provider.js';
import { affectsSetting, getSetting } from './settings.js';

const execFileAsync = promisify(execFile);

export async function readLinuxJournalctlLogs(
  runCommand: (file: string, args: string[]) => Promise<{ stdout: string }> = (file, args) =>
    execFileAsync(file, args) as Promise<{ stdout: string }>,
): Promise<string | null> {
  try {
    const { stdout } = await runCommand('journalctl', ['-u', 'ollama', '-n', '1000', '--no-pager', '--output=cat']);
    return stdout;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export function getForceKillCommand(
  pid: number,
  platform: NodeJS.Platform = process.platform,
): { file: string; args: string[] } {
  const normalizedPid = Math.max(0, Math.trunc(pid));
  if (platform === 'win32') {
    return { file: 'taskkill', args: ['/F', '/PID', String(normalizedPid)] };
  }
  return { file: 'kill', args: ['-9', String(normalizedPid)] };
}

/**
 * Returns available system RAM in GB minus a fixed overhead for the OS and
 * background processes.  On Apple Silicon (unified memory) totalmem() covers
 * both RAM and GPU VRAM, so this is the correct budget for model inference.
 * On discrete-GPU machines we are conservatively using RAM as the budget;
 * it may under-recommend but will never over-recommend.
 */
function getAvailableMemoryGb(): number {
  return totalmem() / 1024 ** 3 - 2;
}

/**
 * Extract the parameter count in billions from a model name or variant tag.
 * Examples: "llama3.2:3b" → 3, "qwen2.5:72b" → 72, "phi4" → null (no explicit size).
 */
export function extractParamsBillions(modelName: string): number | null {
  // Match a size token like ":3b", "-7b", "_72b", ".6b" anywhere in the name.
  const m = /(?:[:\-_.])(\d+(?:\.\d+)?)b\b/i.exec(modelName);
  return m ? parseFloat(m[1]) : null;
}

/**
 * Returns true when the model is likely to run with comfortable speed on the
 * current machine.
 *
 * The formula:
 *   memGB = params × 2 × 0.5   (FP16 weight size × INT4 quantisation factor)
 *   fits  = memGB ≤ availableGB × 0.6
 *
 * The 0.6 headroom factor ensures at least 40 % of RAM remains free for the
 * KV-cache, context buffers, and OS processes.  A model that only barely fits
 * will saturate memory bandwidth and run at unbearably slow speeds — so we
 * exclude it.  When the parameter count cannot be determined from the name
 * (e.g. a base model name like "llama3.2" without a size tag) we return true
 * so that the item is shown rather than silently hidden.  The meaningful
 * recommendation check runs at the variant level where names like
 * "llama3.2:3b" carry an explicit size.
 */
export function isRecommendedForHardware(modelName: string): boolean {
  const params = extractParamsBillions(modelName);
  if (params === null) return true; // Unknown size — show rather than hide
  const memGb = params * 2 * 0.5; // INT4 quant: ~1 GB per billion params
  return memGb <= getAvailableMemoryGb() * 0.6;
}

/**
 * Validates that a fetch response carries an HTML Content-Type.
 * Throws an informative error when a proxy or CDN returns a clearly non-HTML
 * payload (e.g. a JSON error body), so that the caller's regex scraping fails
 * loudly rather than silently producing empty results.
 * Silently passes when the header is absent (some servers omit it).
 */
export function assertHtmlContentType(response: Response): void {
  const rawCt = response.headers?.get('content-type') ?? '';
  const normalizedCt = rawCt.toLowerCase();
  if (rawCt && !normalizedCt.includes('text/html')) {
    throw new Error(`Expected text/html from ${response.url} but got '${rawCt}' (HTTP ${response.status})`);
  }
}

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

function getNumberField(record: unknown, key: string): number | undefined {
  if (!record || typeof record !== 'object') {
    return undefined;
  }
  if (!Object.hasOwn(record, key)) {
    return undefined;
  }
  const value = (record as Record<string, unknown>)[key];
  return typeof value === 'number' ? value : undefined;
}

function getStringField(record: unknown, key: string): string | undefined {
  if (!record || typeof record !== 'object') {
    return undefined;
  }
  if (!Object.hasOwn(record, key)) {
    return undefined;
  }
  const value = (record as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

function updateItemTooltip(item: ModelTreeItem, tooltip: string, emitter: EventEmitter<ModelTreeItem | null>): void {
  if (typeof item.tooltip === 'string' && item.tooltip === tooltip) {
    return;
  }
  item.tooltip = tooltip;
  emitter.fire(item);
}

/**
 * Extract the base model family name from a full model name.
 * Examples:
 *   phi3, phi3.5, phi4 → phi
 *   deepseek-v3.1, deepseek-v3.2 → deepseek
 *   llama2, llama3 → llama
 *   qwen:7b → qwen
 */
/** Atomic multi-token family prefixes that must not be split at dashes. */
const FAMILY_EXCEPTIONS = ['gpt-oss', 'open-orca'];

export function extractModelFamily(modelName: string): string {
  // Remove everything after colon if present
  const baseName = modelName.split(':')[0];

  // Check multi-token family exceptions first (e.g. gpt-oss-*, open-orca-*)
  const baseNameLower = baseName.toLowerCase();
  for (const exception of FAMILY_EXCEPTIONS) {
    if (baseNameLower === exception || baseNameLower.startsWith(`${exception}-`)) {
      return exception;
    }
  }

  // Any dashed family/variant naming (command-r, deepseek-v3.2) groups by prefix.
  const firstDash = baseName.indexOf('-');
  if (firstDash > 0) {
    const prefix = baseName.slice(0, firstDash);
    // Normalize numeric family prefixes (qwen3 -> qwen, qwen3.5 -> qwen)
    // but preserve short alphanumeric prefixes like 'r1' where stripping
    // digits would leave a single character.
    const normalizedPrefix = prefix.replace(/[\d.]+$/, '');
    return (normalizedPrefix.length > 1 ? normalizedPrefix : prefix) || prefix;
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
export function groupModelsByFamily(models: ModelTreeItem[]): Map<string, ModelTreeItem[]> {
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

/**
 * Aggregate capabilities from all child models in a family
 */
export function aggregateFamilyCapabilities(familyModels: ModelTreeItem[]): {
  thinking: boolean;
  tools: boolean;
  vision: boolean;
  embedding: boolean;
} {
  const caps = { thinking: false, tools: false, vision: false, embedding: false };

  for (const model of familyModels) {
    const desc = (model.description ?? '').toString();
    if (desc.includes('🧠')) caps.thinking = true;
    if (desc.includes('🛠️')) caps.tools = true;
    if (desc.includes('👁️')) caps.vision = true;
    if (desc.includes('🧩')) caps.embedding = true;
  }

  return caps;
}

function makeStatusItem(label: string): ModelTreeItem {
  return new ModelTreeItem(label, 'status');
}

function makeStatusActionItem(label: string, commandId: string, title?: string): ModelTreeItem {
  const item = new ModelTreeItem(label, 'status');
  item.command = {
    command: commandId,
    title: title ?? label,
  };
  return item;
}

export type RunningProcessInfo = {
  id?: string;
  durationMs?: number;
  processor?: string;
  size?: number;
  sizeVram?: number;
};

export function formatRelativeFromNow(ms?: number): string {
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

export function formatSizeForTooltip(bytes?: number): string {
  if (!bytes) {
    return 'Unknown';
  }

  const gb = bytes / 1024 ** 3;
  return `${gb.toFixed(1)} GB`;
}

function formatMemorySizes(ramSize: number, vramSize: number): string {
  const ramGB = (ramSize / 1024 ** 3).toFixed(1);
  const vramGB = (vramSize / 1024 ** 3).toFixed(1);
  return `🧮 RAM: ${ramGB}GB | VRAM: ${vramGB}GB`;
}

function formatTotalMemory(totalSize: number): string {
  const totalGB = (totalSize / 1024 ** 3).toFixed(1);
  return `🧮 RAM: ${totalGB}GB`;
}

export function buildMemoryBreakdown(running: RunningProcessInfo, size?: number): string | null {
  const totalSize = running.size ?? size ?? 0;
  const vramSize = running.sizeVram ?? 0;
  const ramSize = totalSize - vramSize;

  if (vramSize > 0 && ramSize > 0) {
    return formatMemorySizes(ramSize, vramSize);
  }
  if (totalSize > 0) {
    return formatTotalMemory(totalSize);
  }
  return null;
}

export function buildProcessorLine(processor: string): string | null {
  const procMatch = /^(\d{1,3})% GPU$/.exec(processor.slice(0, 32));
  if (procMatch) {
    const gpuPct = Number.parseInt(procMatch[1], 10);
    const cpuPct = 100 - gpuPct;
    if (cpuPct > 0 && gpuPct > 0) return `💻 CPU: ${cpuPct}% | GPU: ${gpuPct}%`;
    if (gpuPct === 100) return `💻 GPU: 100%`;
    return null;
  }
  if (processor === 'CPU') return `💻 CPU: 100%`;
  return null;
}

export function buildLocalModelTooltip(
  modelName: string,
  size?: number,
  running?: RunningProcessInfo,
  description?: string,
  capabilities?: { thinking?: boolean; toolCalling?: boolean; imageInput?: boolean; embedding?: boolean },
): string {
  const id = running?.id ?? '—';
  const until = formatRelativeFromNow(running?.durationMs);
  const sizeText = formatSizeForTooltip(size);

  const lines = [`🤖 ${modelName}`, `🆔 ${id}`, `🏋️ ${sizeText}`];

  if (running) {
    const memLine = buildMemoryBreakdown(running, size);
    if (memLine) lines.push(memLine);
    if (running.processor) {
      const procLine = buildProcessorLine(running.processor);
      if (procLine) lines.push(procLine);
    }
  } else {
    lines.push(`⚙️ Not running`);
  }

  lines.push(`⏱️ ${until}`);

  if (capabilities) {
    const capLine = buildCapabilityLines({
      thinking: capabilities.thinking,
      tools: capabilities.toolCalling,
      vision: capabilities.imageInput,
      embedding: capabilities.embedding,
    });
    if (capLine) lines.push(capLine);
  }
  if (description) lines.push(description);
  return lines.join('\n');
}

export function buildCapabilityLines(caps: {
  thinking?: boolean;
  tools?: boolean;
  vision?: boolean;
  embedding?: boolean;
}): string {
  const badges: string[] = [];
  if (caps.thinking) badges.push('🧠 Thinking');
  if (caps.tools) badges.push('🛠️ Tools');
  if (caps.vision) badges.push('👁️ Vision');
  if (caps.embedding) badges.push('🧩 Embedding');
  return badges.join(' | ');
}

/**
 * Build the ollama.com library URL for a model name.
 *
 * Security: each path segment is percent-encoded via `encodeURIComponent` to
 * prevent path traversal (e.g., a model name containing `../`) and HTTP header
 * injection. The base domain is always `https://ollama.com/library/`, so the
 * URL cannot be redirected to an attacker-controlled host regardless of the
 * model name value.
 */
export function getLibraryModelUrl(modelName: string): string {
  const encoded = modelName
    .split('/')
    .map(segment => {
      if (/^\.+$/.test(segment)) {
        // Prevent path dot-segment traversal by percent-encoding dots.
        return segment.replace(/\./g, '%2E');
      }
      return encodeURIComponent(segment);
    })
    .join('/');
  return `https://ollama.com/library/${encoded}`;
}

async function fetchModelPagePreview(
  modelName: string,
  timeoutMs = 8000,
): Promise<{
  title: string;
  description: string;
  capabilities: { thinking: boolean; tools: boolean; vision: boolean; embedding: boolean };
}> {
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
    assertHtmlContentType(response);

    const html = await response.text();
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    const descMatch =
      html.match(/<meta\s+name=["']description["'][^>]*content=["']([^"']*)["']/i) ||
      html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i) ||
      html.match(/<meta\s+property=["']og:description["'][^>]*content=["']([^"']*)["']/i);

    const title = titleMatch?.[1]?.trim() || modelName;
    const description = descMatch?.[1]?.trim() || 'No description available from the library page.';

    // Scope capability detection to dedicated section to avoid false positives.
    const capabilitiesSectionMatch =
      html.match(/<section[^>]*aria-label=["']Capabilities["'][\s\S]*?<\/section>/i) ||
      html.match(/<div[^>]*class=["'][^"']*capabilit[^"']*["'][\s\S]*?<\/div>/i);
    const capabilitiesHtml = capabilitiesSectionMatch?.[0] ?? html;

    const capabilities = {
      thinking: /\bThinking\b/i.test(capabilitiesHtml) || isThinkingModelId(modelName),
      tools: /\bTools\b/i.test(capabilitiesHtml),
      vision: /\bVision\b/i.test(capabilitiesHtml),
      embedding: /\bEmbedding\b/i.test(capabilitiesHtml),
    };

    return { title, description, capabilities };
  } finally {
    clearTimeout(timeout);
  }
}

const MODEL_PREVIEW_CACHE_TTL_MS = 30 * 60 * 1000;
const MODEL_PREVIEW_CACHE_MAX_ENTRIES = 1000;
const MODEL_PREVIEW_CACHE_STORAGE_KEY = 'ollama.modelPreviewCache.v1';

type ModelPagePreview = Awaited<ReturnType<typeof fetchModelPagePreview>>;

const modelPreviewCache = new Map<string, { value: ModelPagePreview; expiresAt: number }>();
const modelPreviewInFlight = new Map<string, Promise<ModelPagePreview>>();
let modelPreviewCacheContext: ExtensionContext | undefined;
let modelPreviewCachePersistTimer: NodeJS.Timeout | null = null;

function hydrateModelPreviewCacheFromStorage(context: ExtensionContext): void {
  modelPreviewCacheContext = context;

  const stored = context.globalState.get<{
    entries: Array<{ key: string; value: ModelPagePreview; expiresAt: number }>;
  }>(MODEL_PREVIEW_CACHE_STORAGE_KEY);

  if (!stored?.entries?.length) {
    return;
  }

  const now = Date.now();
  for (const entry of stored.entries) {
    if (!entry?.key || !entry.value || typeof entry.expiresAt !== 'number' || entry.expiresAt <= now) {
      continue;
    }
    modelPreviewCache.set(entry.key, { value: entry.value, expiresAt: entry.expiresAt });
  }
  pruneModelPreviewCache(now);
}

function schedulePersistModelPreviewCache(): void {
  if (!modelPreviewCacheContext) {
    return;
  }

  if (modelPreviewCachePersistTimer) {
    clearTimeout(modelPreviewCachePersistTimer);
  }

  modelPreviewCachePersistTimer = setTimeout(() => {
    const entries = [...modelPreviewCache.entries()].map(([key, entry]) => ({
      key,
      value: entry.value,
      expiresAt: entry.expiresAt,
    }));
    modelPreviewCacheContext?.globalState
      .update(MODEL_PREVIEW_CACHE_STORAGE_KEY, { entries })
      ?.then(undefined, () => {});
    modelPreviewCachePersistTimer = null;
  }, 250);
}

export type ModelPreviewCacheSnapshot = {
  entries: number;
  inFlight: number;
  maxEntries: number;
  ttlMs: number;
};

export function getModelPreviewCacheSnapshot(): ModelPreviewCacheSnapshot {
  return {
    entries: modelPreviewCache.size,
    inFlight: modelPreviewInFlight.size,
    maxEntries: MODEL_PREVIEW_CACHE_MAX_ENTRIES,
    ttlMs: MODEL_PREVIEW_CACHE_TTL_MS,
  };
}

function pruneModelPreviewCache(now: number): void {
  for (const [key, entry] of modelPreviewCache.entries()) {
    if (entry.expiresAt <= now) {
      modelPreviewCache.delete(key);
    }
  }

  if (modelPreviewCache.size <= MODEL_PREVIEW_CACHE_MAX_ENTRIES) {
    return;
  }

  const sortedByExpiry = [...modelPreviewCache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
  const overflow = modelPreviewCache.size - MODEL_PREVIEW_CACHE_MAX_ENTRIES;
  for (let i = 0; i < overflow; i++) {
    const key = sortedByExpiry[i]?.[0];
    if (key) {
      modelPreviewCache.delete(key);
    }
  }
}

async function getCachedModelPagePreview(modelName: string, timeoutMs = 8000): Promise<ModelPagePreview> {
  const cacheKey = modelName.toLowerCase();
  const now = Date.now();

  const cached = modelPreviewCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const inFlight = modelPreviewInFlight.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const request = fetchModelPagePreview(modelName, timeoutMs)
    .then(preview => {
      const updatedNow = Date.now();
      modelPreviewCache.set(cacheKey, {
        value: preview,
        expiresAt: updatedNow + MODEL_PREVIEW_CACHE_TTL_MS,
      });
      pruneModelPreviewCache(updatedNow);
      schedulePersistModelPreviewCache();
      return preview;
    })
    .finally(() => {
      modelPreviewInFlight.delete(cacheKey);
    });

  modelPreviewInFlight.set(cacheKey, request);
  return request;
}

/**
 * Local models view provider (installed + running state)
 */
export class LocalModelsProvider implements TreeDataProvider<ModelTreeItem>, Disposable {
  private treeChangeEmitter = new EventEmitter<ModelTreeItem | null>();
  readonly onDidChangeTreeData: Event<ModelTreeItem | null> = this.treeChangeEmitter.event;

  filterText = '';
  grouped = true;
  recommendedOnly = false;
  capabilityFilters: Set<string> = new Set();

  private refreshIntervals: NodeJS.Timeout[] = [];
  private configListenerDisposable?: Disposable;
  private localModelCapabilitiesCache = new Map<string, ModelCapabilities>();
  private localModelCapabilitiesInFlight = new Set<string>();
  private refreshDebounceTimer: NodeJS.Timeout | undefined;
  private cachedLocalModelNames = new Set<string>();
  private static readonly LOCAL_CAPABILITIES_STORAGE_KEY = 'ollama.localModelCapabilities.v1';

  constructor(
    private client: Ollama,
    private context?: ExtensionContext,
    private logChannel?: DiagnosticsLogger,
    private onLocalModelsChanged?: () => void,
  ) {
    this.hydrateLocalCapabilitiesFromStorage();
    this.startAutoRefresh();

    // Register config listener once — not inside startAutoRefresh() which can be called multiple times
    this.configListenerDisposable = workspace.onDidChangeConfiguration(e => {
      if (affectsSetting(e, 'localModelRefreshInterval')) {
        this.logChannel?.debug('[client] ollama settings changed, restarting auto-refresh');
        this.stopAutoRefresh();
        this.startAutoRefresh();
      }
    });
  }

  private hydrateLocalCapabilitiesFromStorage(): void {
    if (!this.context?.globalState) {
      return;
    }

    const stored = this.context.globalState.get<Record<string, ModelCapabilities>>(
      LocalModelsProvider.LOCAL_CAPABILITIES_STORAGE_KEY,
    );
    if (!stored) {
      return;
    }

    for (const [modelName, capabilities] of Object.entries(stored)) {
      this.localModelCapabilitiesCache.set(modelName, capabilities);
    }
  }

  private persistLocalCapabilitiesToStorage(): void {
    if (!this.context?.globalState) {
      return;
    }

    const serialized: Record<string, ModelCapabilities> = {};
    for (const [modelName, capabilities] of this.localModelCapabilitiesCache.entries()) {
      serialized[modelName] = capabilities;
    }

    this.context.globalState
      .update(LocalModelsProvider.LOCAL_CAPABILITIES_STORAGE_KEY, serialized)
      .then(undefined, () => {});
  }

  /**
   * Get tree items for a given element
   */
  async getChildren(element?: ModelTreeItem): Promise<ModelTreeItem[]> {
    if (!element) {
      const models = await this.getLocalModels();
      if (models.length === 0) return [makeStatusItem('No local models')];
      if (models.every(model => model.type === 'status')) return models;
      if (!this.grouped) return this.getLocalChildrenFlat(models);
      return this.getLocalChildrenGrouped(models);
    }

    if (element.type === 'model-group') {
      const models = await this.getLocalModels();
      return models
        .filter(m => extractModelFamily(m.label) === element.label)
        .sort((a, b) => a.label.localeCompare(b.label));
    }

    return [];
  }

  private getLocalChildrenFlat(models: ModelTreeItem[]): ModelTreeItem[] {
    const filterLower = this.filterText.toLowerCase();
    return models
      .filter(
        m =>
          m.type !== 'status' &&
          (!filterLower ||
            m.label.toLowerCase().includes(filterLower) ||
            (typeof m.tooltip === 'string' && m.tooltip.toLowerCase().includes(filterLower))) &&
          this.modelMatchesCapabilityFilters(m.label) &&
          (!this.recommendedOnly || isRecommendedForHardware(m.label)),
      )
      .sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()));
  }

  private getLocalChildrenGrouped(models: ModelTreeItem[]): ModelTreeItem[] {
    const groups = groupModelsByFamily(models);
    const filterLower = this.filterText.toLowerCase();

    const filteredEntries = Array.from(groups.entries())
      .filter(
        ([familyName, familyModels]) =>
          (!filterLower ||
            familyName.toLowerCase().includes(filterLower) ||
            familyModels.some(
              m =>
                m.label.toLowerCase().includes(filterLower) ||
                (typeof m.tooltip === 'string' && m.tooltip.toLowerCase().includes(filterLower)),
            )) &&
          (this.capabilityFilters.size === 0 || familyModels.some(m => this.modelMatchesCapabilityFilters(m.label))) &&
          (!this.recommendedOnly || familyModels.some(m => isRecommendedForHardware(m.label))),
      )
      .sort((a, b) => a[0].localeCompare(b[0]));

    const result: ModelTreeItem[] = [];
    for (const [familyName, familyModels] of filteredEntries) {
      const groupItem = new ModelTreeItem(familyName, 'model-group');
      const familyCaps = aggregateFamilyCapabilities(familyModels);
      const capLine = buildCapabilityLines({
        thinking: familyCaps.thinking,
        tools: familyCaps.tools,
        vision: familyCaps.vision,
        embedding: familyCaps.embedding,
      });

      const badges: string[] = [];
      if (familyCaps.thinking) badges.push('🧠');
      if (familyCaps.tools) badges.push('🛠️');
      if (familyCaps.vision) badges.push('👁️');
      if (familyCaps.embedding) badges.push('🧩');
      if (badges.length > 0) groupItem.description = badges.join(' ');

      const tooltipLines = [`${familyName} family (${familyModels.length} models)`];
      if (capLine) tooltipLines.push(capLine);
      groupItem.tooltip = tooltipLines.join('\n');
      result.push(groupItem);
    }
    return result;
  }

  /**
   * Get tree item metadata
   */
  getTreeItem(element: ModelTreeItem): TreeItem {
    return element;
  }

  private async getLocalModels(): Promise<ModelTreeItem[]> {
    try {
      this.logChannel?.debug('[client] loading local models via list() and ps()...');
      const [listResponse, psResponse] = await Promise.all([this.client.list(), this.client.ps()]);

      const runningMap = new Map<string, RunningProcessInfo>();
      for (const model of psResponse.models) {
        const durationMs = model.expires_at
          ? Math.max(0, new Date(model.expires_at).getTime() - Date.now())
          : undefined;
        const digest = getStringField(model, 'digest');
        const id = digest ? digest.slice(0, 12) : undefined;

        let processor: string | undefined;
        const sizeVram = getNumberField(model, 'size_vram');
        const size = getNumberField(model, 'size');
        if (typeof sizeVram === 'number' && typeof size === 'number' && size > 0) {
          const gpuPct = Math.min(100, Math.max(0, Math.round((sizeVram / size) * 100)));
          processor = gpuPct > 0 ? `${gpuPct}% GPU` : 'CPU';
        }

        runningMap.set(model.name, { durationMs, id, processor, size, sizeVram });
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
          item.command = {
            command: 'opilot.openModelSettingsForModel',
            title: 'Open Model Settings',
            arguments: [model.name],
          };
          // Set initial tooltip
          item.tooltip = buildLocalModelTooltip(model.name, model.size, running);
          // Fetch tooltip description asynchronously
          getCachedModelPagePreview(model.name).then(
            preview => {
              const nextTooltip = buildLocalModelTooltip(model.name, model.size, running, preview.description);
              updateItemTooltip(item, nextTooltip, this.treeChangeEmitter);
            },
            () => {
              // Keep initial tooltip on error
            },
          );

          const appendBadges = (caps: ModelCapabilities) => {
            const badges: string[] = [];
            if (caps.thinking || isThinkingModelId(model.name)) badges.push('🧠');
            if (caps.toolCalling) badges.push('🛠️');
            if (caps.imageInput) badges.push('👁️');
            if (caps.embedding) badges.push('🧩');
            if (badges.length === 0) {
              return;
            }

            const badgeStr = badges.join(' ');
            const existing = (item.description ?? '').toString();
            // Strip any prior emoji badges before re-appending
            const cleaned = existing.replace(/\s*(?:🧠|🛠️|👁️|🧩)(?:\s+(?:🧠|🛠️|👁️|🧩))*\s*$/, '').trim();
            item.description = cleaned ? `${cleaned} ${badgeStr}` : badgeStr;
          };

          const cachedCaps = this.localModelCapabilitiesCache.get(model.name);
          if (cachedCaps) {
            appendBadges(cachedCaps);
            // Update tooltip with capabilities
            getCachedModelPagePreview(model.name).then(
              preview => {
                const nextTooltip = buildLocalModelTooltip(
                  model.name,
                  model.size,
                  running,
                  preview.description,
                  cachedCaps,
                );
                updateItemTooltip(item, nextTooltip, this.treeChangeEmitter);
              },
              () => {
                const nextTooltip = buildLocalModelTooltip(model.name, model.size, running, undefined, cachedCaps);
                updateItemTooltip(item, nextTooltip, this.treeChangeEmitter);
              },
            );
          } else if (!this.localModelCapabilitiesInFlight.has(model.name)) {
            this.localModelCapabilitiesInFlight.add(model.name);
            // Fetch capabilities once per local model name.
            fetchModelCapabilities(this.client, model.name)
              .then(caps => {
                this.localModelCapabilitiesCache.set(model.name, caps);
                this.persistLocalCapabilitiesToStorage();
                appendBadges(caps);
                // Update tooltip with capabilities
                getCachedModelPagePreview(model.name).then(
                  preview => {
                    const nextTooltip = buildLocalModelTooltip(
                      model.name,
                      model.size,
                      running,
                      preview.description,
                      caps,
                    );
                    updateItemTooltip(item, nextTooltip, this.treeChangeEmitter);
                  },
                  () => {
                    const nextTooltip = buildLocalModelTooltip(model.name, model.size, running, undefined, caps);
                    updateItemTooltip(item, nextTooltip, this.treeChangeEmitter);
                  },
                );
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
        `[client] local models loaded: ${items.length} total, ${items.filter(m => m.type === 'local-running').length} running`,
      );

      this.cachedLocalModelNames = new Set(visibleLocalModels.map(m => m.name));
      return items.length > 0 ? items : [makeStatusItem('No local models found')];
    } catch (error) {
      reportError(this.logChannel, 'Failed to load local models', error, { showToUser: false });
      return [makeStatusItem('Failed to load local models')];
    }
  }

  /**
   * Re-render the tree without clearing cached data.
   * Use when only display mode changes (filtering) to avoid unnecessary API calls.
   */
  softRefresh(): void {
    this.treeChangeEmitter.fire(null);
  }

  private localModelMatchesSingleFilter(
    filter: string,
    caps: ModelCapabilities | undefined,
    modelName: string,
  ): boolean {
    if (filter === 'thinking') return caps ? !!caps.thinking : isThinkingModelId(modelName);
    if (filter === 'tools') return !caps || !!caps.toolCalling;
    if (filter === 'vision') return !caps || !!caps.imageInput;
    if (filter === 'embedding') return !caps || !!caps.embedding;
    return true;
  }

  private modelMatchesCapabilityFilters(modelName: string): boolean {
    if (this.capabilityFilters.size === 0) return true;
    const caps = this.localModelCapabilitiesCache.get(modelName);
    for (const filter of this.capabilityFilters) {
      if (!this.localModelMatchesSingleFilter(filter, caps, modelName)) return false;
    }
    return true;
  }

  /**
   * Refresh the tree (manual refresh button - forces immediate refresh)
   */
  refresh(): void {
    this.logChannel?.debug('[client] manual refresh triggered (debounced)');
    if (this.refreshDebounceTimer) {
      clearTimeout(this.refreshDebounceTimer);
    }
    this.refreshDebounceTimer = setTimeout(() => {
      this.treeChangeEmitter.fire(null);
      try {
        this.onLocalModelsChanged?.();
      } catch (err) {
        reportError(this.logChannel, 'Error during onLocalModelsChanged handler', err, { showToUser: false });
      }
      this.refreshDebounceTimer = undefined;
    }, 300);
  }

  /**
   * Get the cached set of locally installed model names (populated after each fetch)
   */
  getCachedLocalModelNames(): Set<string> {
    return new Set(this.cachedLocalModelNames);
  }

  getProfilingSnapshot(): {
    capabilityCacheEntries: number;
    capabilityInFlight: number;
    cachedLocalNames: number;
  } {
    return {
      capabilityCacheEntries: this.localModelCapabilitiesCache.size,
      capabilityInFlight: this.localModelCapabilitiesInFlight.size,
      cachedLocalNames: this.cachedLocalModelNames.size,
    };
  }

  /**
   * Start auto-refresh timer for local models
   */
  private startAutoRefresh(): void {
    const localRefreshSecs = getSetting<number>('localModelRefreshInterval', 30);

    // Auto-refresh local/running models
    if (localRefreshSecs > 0) {
      this.logChannel?.debug(`[client] auto-refresh set for local models every ${localRefreshSecs}s`);
      const localInterval = setInterval(() => {
        this.refresh();
      }, localRefreshSecs * 1000);
      this.refreshIntervals.push(localInterval);
    }
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
    this.configListenerDisposable?.dispose();
    if (this.refreshDebounceTimer) {
      clearTimeout(this.refreshDebounceTimer);
      this.refreshDebounceTimer = undefined;
    }
  }

  /**
   * Delete a model
   */
  async deleteModel(modelName: string): Promise<void> {
    try {
      this.logChannel?.debug(`[client] deleting model: ${modelName}`);
      await this.client.delete({ model: modelName });
      this.logChannel?.info(`[client] model deleted: ${modelName}`);
      this.refresh();
      window.showInformationMessage(`Model ${modelName} deleted`);
    } catch (error) {
      this.logChannel?.exception(`[client] failed to delete model ${modelName}`, error);
      const msg = error instanceof Error ? error.message : 'Unknown error';
      window.showErrorMessage(`Failed to delete model: ${msg}`);
    }
  }

  /**
   * Start (warm) a local model
   */
  async startModel(modelName: string): Promise<void> {
    try {
      this.logChannel?.debug(`[client] starting local model: ${modelName}`);
      await window.withProgress({ location: 15, title: `Starting ${modelName}...` }, async () => {
        const isCloudModel = this.isCloudTaggedModel(modelName);
        const activeClient = isCloudModel && this.context ? await getCloudOllamaClient(this.context) : this.client;
        if (isCloudModel) {
          // Cloud models should be pulled first (same behavior as `ollama run`).
          this.logChannel?.info(`[client] pulling cloud model before start: ${modelName}`);
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
          this.logChannel?.info(`[client] model started: ${modelName}`);
        } else if (isCloudModel) {
          this.logChannel?.info(`[client] cloud model warmed but not persistent in /api/ps: ${modelName}`);
        } else {
          this.logChannel?.warn(`[client] model warm-up completed but not shown as running: ${modelName}`);
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
      this.logChannel?.exception(`[client] failed to start model ${modelName}`, error);
      const msg = error instanceof Error ? error.message : 'Unknown error';
      window.showErrorMessage(`Failed to start model: ${msg}`);
    }
  }

  private isCloudTaggedModel(modelName: string): boolean {
    const tag = modelName.split(':')[1] ?? '';
    return tag === 'cloud' || tag.endsWith('-cloud');
  }

  /**
   * Extract the PID for a running model from Ollama server logs
   */
  private async extractModelPidFromLogs(modelName: string): Promise<number | null> {
    try {
      const platform = process.platform;
      let logContent: string;

      if (platform === 'darwin') {
        const logPath = join(homedir(), '.ollama', 'logs', 'server.log');
        logContent = await readFile(logPath, 'utf-8');
      } else if (platform === 'win32') {
        const logPath = join(process.env['LOCALAPPDATA'] ?? '', 'Ollama', 'server.log');
        logContent = await readFile(logPath, 'utf-8');
      } else if (platform === 'linux') {
        // On Linux, use journalctl to get recent logs when available.
        const logs = await readLinuxJournalctlLogs();
        if (logs === null) {
          this.logChannel?.warn('[client] journalctl not found in PATH; cannot extract model PID from logs');
          return null;
        }
        logContent = logs;
      } else {
        this.logChannel?.warn(`[client] PID extraction not supported on platform: ${platform}`);
        return null;
      }

      // Parse log lines looking for runner.name matching our model and extract runner.pid
      // Example: runner.name=registry.ollama.ai/library/qwen3:0.6b ... runner.pid=64475
      const lines = logContent.split('\n').reverse(); // Start from most recent
      const modelBase = modelName.split(':')[0];

      for (const line of lines) {
        if (line.includes('runner.name=') && line.includes(modelBase) && line.includes('runner.pid=')) {
          const pidMatch = line.match(/runner\.pid=(\d+)/);
          if (pidMatch) {
            const pid = Number.parseInt(pidMatch[1], 10);
            this.logChannel?.debug(`[client] extracted PID ${pid} for model ${modelName}`);
            return pid;
          }
        }
      }

      this.logChannel?.debug(`[client] no PID found in logs for model ${modelName}`);
      return null;
    } catch (error) {
      this.logChannel?.exception(`[client] failed to extract PID for ${modelName}`, error);
      return null;
    }
  }

  /**
   * Force-kill a model process by PID
   */
  private async forceKillProcess(pid: number): Promise<boolean> {
    try {
      const { file, args } = getForceKillCommand(pid);

      this.logChannel?.info(`[client] force-killing process ${pid}`);
      await execFileAsync(file, args);
      return true;
    } catch (error) {
      this.logChannel?.exception(`[client] failed to kill process ${pid}`, error);
      return false;
    }
  }

  /**
   * Stop a running model and show a progress indicator until it is fully unloaded
   */
  private async attemptForceKill(modelName: string, pid: number): Promise<void> {
    const answer = await window.showWarningMessage(
      `Model ${modelName} did not stop after 30 seconds. Force kill the process (PID ${pid})?`,
      'Force Kill',
      'Cancel',
    );
    if (answer !== 'Force Kill') return;

    const killed = await this.forceKillProcess(pid);
    if (!killed) {
      window.showErrorMessage(`Failed to kill process ${pid}. Try restarting Ollama or kill manually.`);
      return;
    }

    await new Promise(resolve => setTimeout(resolve, 1000));
    try {
      const { models } = await this.client.ps();
      if (!models.some(m => m.name === modelName)) {
        this.logChannel?.info(`[client] model force-killed successfully: ${modelName}`);
        this.refresh();
        window.showInformationMessage(`Model ${modelName} force-killed`);
        return;
      }
    } catch {
      this.logChannel?.info(`[client] model force-killed (ps check failed): ${modelName}`);
      this.refresh();
      window.showInformationMessage(`Model ${modelName} force-killed`);
      return;
    }
    window.showErrorMessage(`Failed to verify model ${modelName} was killed. Check Ollama logs.`);
  }

  private async handleStopTimeout(modelName: string): Promise<void> {
    this.logChannel?.warn(`[client] model ${modelName} still running after 30s timeout`);
    const pid = await this.extractModelPidFromLogs(modelName);
    if (pid !== null) {
      await this.attemptForceKill(modelName, pid);
    } else {
      window.showWarningMessage(`Model ${modelName} did not stop after 30 seconds. Try restarting the Ollama server.`);
    }
  }

  async stopModel(modelName: string): Promise<void> {
    try {
      const isCloudModel = this.isCloudTaggedModel(modelName);
      this.logChannel?.debug(`[client] stopping model: ${modelName}`);
      let modelStillRunning = false;

      await window.withProgress(
        { location: ProgressLocation.Notification, title: `Stopping ${modelName}…`, cancellable: false },
        async () => {
          const activeClient = isCloudModel && this.context ? await getCloudOllamaClient(this.context) : this.client;
          await activeClient.generate({ model: modelName, prompt: '', stream: false, keep_alive: 0 });
          for (let i = 0; i < 30; i++) {
            await new Promise<void>(resolve => setTimeout(resolve, 1000));
            try {
              const { models } = await this.client.ps();
              if (!models.some(m => m.name === modelName)) return;
            } catch {
              return;
            }
          }
          modelStillRunning = true;
        },
      );

      if (modelStillRunning && !isCloudModel) {
        await this.handleStopTimeout(modelName);
        return;
      }

      this.logChannel?.info(`[client] model stopped: ${modelName}`);
      this.refresh();
      window.showInformationMessage(`Model ${modelName} stopped`);
    } catch (error) {
      this.logChannel?.exception(`[client] failed to stop model ${modelName}`, error);
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
  recommendedOnly = false;
  capabilityFilters: Set<string> = new Set();

  private cache: string[] = [];
  private cacheTimeMs = 0;
  private cacheGeneration = 0;
  private refreshTimeout: NodeJS.Timeout | null = null;
  private refreshIntervals: NodeJS.Timeout[] = [];
  private loadPromise: Promise<string[]> | null = null;
  /** Caches raw variant metadata (names + sizes) only — not materialized tree items. */
  private variantsCache = new Map<string, VariantRaw[]>();
  /** Base model names that are available in Ollama Cloud catalog. */
  private cloudCatalogNames = new Set<string>();
  private localProvider?: LocalModelsProvider;
  private context?: ExtensionContext;

  private static readonly CACHE_STORAGE_KEY = 'ollama.libraryModelsCache.v1';

  private static readonly CACHE_VERSION = 1;

  constructor(private logChannel?: DiagnosticsLogger) {
    this.startAutoRefresh();
  }

  attachContext(context: ExtensionContext): void {
    this.context = context;
    this.hydrateCacheFromStorage();
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
      return this.getChildrenForLibraryModel(element);
    }

    if (element?.type === 'model-group') {
      return this.getChildrenForModelGroup(element);
    }

    if (element) {
      return [];
    }

    const models = await this.getLibraryModels();
    if (models.length === 0) {
      return [makeStatusItem('No library models found')];
    }
    if (models.every(model => model.type === 'status')) {
      return models;
    }

    if (!this.grouped) {
      return this.getChildrenFlat(models);
    }
    return this.getChildrenGrouped(models);
  }

  private async getChildrenForLibraryModel(element: ModelTreeItem): Promise<ModelTreeItem[]> {
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
    return this.filterVariantsByRecommended(this.materializeVariants(raw, this.getLocalModelNames()));
  }

  private async getChildrenForModelGroup(element: ModelTreeItem): Promise<ModelTreeItem[]> {
    const models = await this.getLibraryModels();
    const groupedModels = models
      .filter(m => extractModelFamily(m.label) === element.label)
      .sort((a, b) => a.label.localeCompare(b.label));

    if (groupedModels.length === 1 && groupedModels[0].label === element.label) {
      const modelLabel = groupedModels[0].label;
      let raw = this.variantsCache.get(modelLabel);
      if (!raw) {
        const fetched = await this.fetchModelVariants(modelLabel);
        if (fetched === null) return [makeStatusItem('Failed to load variants')];
        if (fetched.length === 0) return [makeStatusItem('No variants found')];
        this.variantsCache.set(modelLabel, fetched);
        raw = fetched;
      }
      if (raw.length === 0) return [makeStatusItem('No variants found')];
      return this.filterVariantsByRecommended(this.materializeVariants(raw, this.getLocalModelNames()));
    }

    return groupedModels;
  }

  private appendVariantsForModel(
    model: ModelTreeItem,
    filterLower: string,
    localNames: Set<string>,
    allItems: ModelTreeItem[],
  ): void {
    const cachedVariants = this.variantsCache.get(model.label);
    if (cachedVariants) {
      const variants = this.materializeVariants(cachedVariants, localNames);
      const filteredVariants = variants.filter(
        v =>
          !filterLower ||
          v.label.toLowerCase().includes(filterLower) ||
          (typeof v.tooltip === 'string' && v.tooltip.toLowerCase().includes(filterLower)),
      );
      allItems.push(...filteredVariants);
    } else {
      this.fetchModelVariants(model.label).then(
        raw => {
          if (raw) {
            this.variantsCache.set(model.label, raw);
            this.treeChangeEmitter.fire(null);
          }
        },
        () => {},
      );
    }
  }

  private modelMatchesTextFilter(model: ModelTreeItem, filterLower: string): boolean {
    if (!filterLower) return true;
    if (model.label.toLowerCase().includes(filterLower)) return true;
    if (typeof model.tooltip === 'string' && model.tooltip.toLowerCase().includes(filterLower)) return true;
    return false;
  }

  private isModelInstalled(model: ModelTreeItem, localNames: Set<string>): boolean {
    return Array.from(localNames).some(local => local === model.label || local.startsWith(`${model.label}:`));
  }

  private applyRecommendedFilter(items: ModelTreeItem[]): ModelTreeItem[] {
    if (!this.recommendedOnly) return items;
    return items.filter(item => {
      if (item.type === 'status') return true;
      const cached = this.variantsCache.get(item.label);
      if (!cached) return true;
      return cached.some(v => isRecommendedForHardware(v.name));
    });
  }

  private getChildrenFlat(models: ModelTreeItem[]): ModelTreeItem[] {
    const filterLower = this.filterText.toLowerCase();
    const localNames = this.getLocalModelNames();
    const allItems: ModelTreeItem[] = [];

    const capabilityFilteredModels =
      this.capabilityFilters.size > 0
        ? models.filter(m => m.type === 'status' || this.modelMatchesCapabilityFilters(m.label, localNames))
        : models;

    for (const model of capabilityFilteredModels) {
      if (model.type === 'status') {
        allItems.push(model);
        continue;
      }

      if (this.modelMatchesTextFilter(model, filterLower)) {
        model.collapsibleState = TreeItemCollapsibleState.None;
        if (this.isModelInstalled(model, localNames)) {
          model.iconPath = createThemeIcon('check');
        }
        allItems.push(model);
      }

      if (!this.recommendedOnly) {
        this.appendVariantsForModel(model, filterLower, localNames, allItems);
      }
    }

    const filteredItems = this.applyRecommendedFilter(allItems);
    return filteredItems.sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()));
  }

  private getChildrenGrouped(models: ModelTreeItem[]): ModelTreeItem[] {
    const groups = groupModelsByFamily(models);
    const filterLower = this.filterText.toLowerCase();
    const localNames = this.getLocalModelNames();

    const filteredEntries = Array.from(groups.entries())
      .filter(
        ([familyName, familyModels]) =>
          (!filterLower ||
            familyName.toLowerCase().includes(filterLower) ||
            familyModels.some(
              m =>
                m.label.toLowerCase().includes(filterLower) ||
                (typeof m.tooltip === 'string' && m.tooltip.toLowerCase().includes(filterLower)),
            )) &&
          (!this.recommendedOnly ||
            familyModels.some(m => {
              const cached = this.variantsCache.get(m.label);
              if (!cached) return true;
              return cached.some(v => isRecommendedForHardware(v.name));
            })) &&
          (this.capabilityFilters.size === 0 ||
            familyModels.some(m => this.modelMatchesCapabilityFilters(m.label, localNames))),
      )
      .sort((a, b) => a[0].localeCompare(b[0]));

    const result: ModelTreeItem[] = [];
    for (const [familyName, familyModels] of filteredEntries) {
      if (familyModels.length === 1) {
        result.push(familyModels[0]);
      } else {
        const groupItem = new ModelTreeItem(familyName, 'model-group');
        const familyCaps = aggregateFamilyCapabilities(familyModels);
        const capLine = buildCapabilityLines({
          thinking: familyCaps.thinking,
          tools: familyCaps.tools,
          vision: familyCaps.vision,
          embedding: familyCaps.embedding,
        });

        const badges: string[] = [];
        if (familyCaps.thinking) badges.push('🧠');
        if (familyCaps.tools) badges.push('🛠️');
        if (familyCaps.vision) badges.push('👁️');
        if (familyCaps.embedding) badges.push('🧩');
        if (badges.length > 0) {
          groupItem.description = badges.join(' ');
        }

        const tooltipLines = [`${familyName} family (${familyModels.length} models)`];
        if (capLine) tooltipLines.push(capLine);
        groupItem.tooltip = tooltipLines.join('\n');
        result.push(groupItem);
      }
    }
    return result;
  }

  refresh(): void {
    this.cache = [];
    this.cacheTimeMs = 0;
    this.loadPromise = null;
    this.variantsCache.clear();
    this.cloudCatalogNames.clear();
    this.cacheGeneration++;
    this.context?.globalState.update(LibraryModelsProvider.CACHE_STORAGE_KEY, undefined)?.then(undefined, () => {});
    this.treeChangeEmitter.fire(null);
  }

  /**
   * Re-render the tree without clearing any cached data.
   * Use this when only the display mode changes (grouping, filtering) so we
   * don't trigger unnecessary network re-fetches.
   */
  softRefresh(): void {
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

  getProfilingSnapshot(): {
    modelCacheEntries: number;
    variantCacheFamilies: number;
    cloudCatalogNames: number;
    hasLoadPromise: boolean;
  } {
    return {
      modelCacheEntries: this.cache.length,
      variantCacheFamilies: this.variantsCache.size,
      cloudCatalogNames: this.cloudCatalogNames.size,
      hasLoadPromise: this.loadPromise !== null,
    };
  }

  /**
   * Returns true when `modelName` satisfies all active capability filters.
   * Uses the module-level modelPreviewCache for synchronous capability lookups;
   * shows models optimistically when preview data isn't cached yet (except for
   * Downloaded and Cloud, which are determined from local state directly).
   */
  private libraryModelMatchesSingleFilter(
    filter: string,
    caps: { thinking: boolean; tools: boolean; vision: boolean; embedding: boolean } | undefined,
    isDownloaded: boolean,
    isCloudModel: boolean,
    modelName: string,
  ): boolean {
    if (filter === 'thinking') return caps ? !!caps.thinking : isThinkingModelId(modelName);
    if (filter === 'tools') return !caps || !!caps.tools;
    if (filter === 'vision') return !caps || !!caps.vision;
    if (filter === 'embedding') return !caps || !!caps.embedding;
    if (filter === 'downloaded') return isDownloaded;
    if (filter === 'cloud') return isCloudModel;
    return true;
  }

  private modelMatchesCapabilityFilters(modelName: string, localNames: Set<string>): boolean {
    if (this.capabilityFilters.size === 0) return true;

    const cacheKey = modelName.toLowerCase();
    const cached = modelPreviewCache.get(cacheKey);
    const caps = cached?.value?.capabilities;
    const isCloudModel = this.cloudCatalogNames.has(cacheKey);
    const isDownloaded = Array.from(localNames).some(l => l === modelName || l.startsWith(`${modelName}:`));

    for (const filter of this.capabilityFilters) {
      if (!this.libraryModelMatchesSingleFilter(filter, caps, isDownloaded, isCloudModel, modelName)) return false;
    }
    return true;
  }

  /** When recommendedOnly is active, keep only variants that fit the hardware. */
  private filterVariantsByRecommended(variants: ModelTreeItem[]): ModelTreeItem[] {
    if (!this.recommendedOnly) return variants;
    const filtered = variants.filter(v => isRecommendedForHardware(v.label));
    return filtered.length > 0 ? filtered : [makeStatusItem('No recommended variants for your hardware')];
  }

  private materializeVariants(raw: VariantRaw[], localNames: Set<string>): ModelTreeItem[] {
    return raw.map(({ name, size }) => {
      const isDownloaded = localNames.has(name);
      const item = new ModelTreeItem(
        name,
        isDownloaded ? 'library-model-downloaded-variant' : 'library-model-variant',
        size,
      );
      const tag = name.split(':')[1] ?? '';
      const isCloudVariant = tag === 'cloud' || tag.endsWith('-cloud');
      if (isCloudVariant) {
        const existing = (item.description ?? '').toString();
        item.description = existing ? `${existing} ☁️` : '☁️';
      }

      item.tooltip = isCloudVariant ? `🤖 ${name}\n☁️ Cloud` : `🤖 ${name}`;

      // Fetch description/capabilities asynchronously for leaf variants.
      getCachedModelPagePreview(name).then(
        preview => {
          const badges: string[] = [];
          if (isCloudVariant) badges.push('☁️');
          if (preview.capabilities.thinking || isThinkingModelId(name)) badges.push('🧠');
          if (preview.capabilities.tools) badges.push('🛠️');
          if (preview.capabilities.vision) badges.push('👁️');
          if (preview.capabilities.embedding) badges.push('🧩');

          const isRecommended = isRecommendedForHardware(name);
          if (isRecommended) {
            badges.push('👍');
          }

          if (badges.length > 0) {
            const existing = (item.description ?? '').toString();
            // Remove previously appended capability badges, keep size text intact.
            const cleaned = existing.replace(/\s*(?:☁️|🧠|🛠️|👁️|🧩|👍)(?:\s+(?:☁️|🧠|🛠️|👁️|🧩|👍))*\s*$/, '').trim();
            const badgeStr = badges.join(' ');
            item.description = cleaned ? `${cleaned} ${badgeStr}` : badgeStr;
          }

          const tooltipLines = [`🤖 ${name}`];
          if (isCloudVariant) {
            tooltipLines.push('☁️ Cloud');
          }
          const capLine = buildCapabilityLines(preview.capabilities);
          if (capLine) {
            tooltipLines.push(capLine);
          }
          if (isRecommended) tooltipLines.push('👍 Recommended for your hardware');
          if (preview.description) tooltipLines.push(preview.description);

          updateItemTooltip(item, tooltipLines.join('\n'), this.treeChangeEmitter);
        },
        () => {
          // Keep initial tooltip.
        },
      );

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
    if (this.cache.length > 0) {
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
          this.persistCacheToStorage();
        }
        return names;
      })
      .catch(error => {
        reportError(this.logChannel, 'Library fetch failed', error, { showToUser: false });
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

  private hydrateCacheFromStorage(): void {
    const stored = this.context?.globalState.get<{
      version: number;
      names: string[];
      cloudNames: string[];
      cachedAtMs: number;
    }>(LibraryModelsProvider.CACHE_STORAGE_KEY);

    if (!stored) {
      return;
    }

    if (stored.version !== LibraryModelsProvider.CACHE_VERSION) {
      return;
    }

    if (!Array.isArray(stored.names) || stored.names.length === 0) {
      return;
    }

    this.cache = [...new Set(stored.names.filter(Boolean))];
    this.cloudCatalogNames = new Set((stored.cloudNames ?? []).filter(Boolean).map(name => name.toLowerCase()));
    this.cacheTimeMs = typeof stored.cachedAtMs === 'number' ? stored.cachedAtMs : Date.now();
  }

  private persistCacheToStorage(): void {
    this.context?.globalState
      .update(LibraryModelsProvider.CACHE_STORAGE_KEY, {
        version: LibraryModelsProvider.CACHE_VERSION,
        names: this.cache,
        cloudNames: [...this.cloudCatalogNames],
        cachedAtMs: this.cacheTimeMs,
      })
      ?.then(undefined, () => {});
  }

  private async fetchLibraryModelNames(timeoutMs: number): Promise<string[]> {
    this.logChannel?.debug(`[client] fetching remote model library from ollama.com (timeout=${timeoutMs}ms)`);

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
      assertHtmlContentType(response);

      const html = await response.text();
      let cloudHtml = '';
      try {
        const cloudResponse = await fetch('https://ollama.com/search?c=cloud', {
          method: 'GET',
          signal: controller.signal,
        });
        if (cloudResponse.ok) {
          cloudHtml = await cloudResponse.text();
        }
      } catch {
        // Cloud catalog fetch is best-effort; continue with base library list.
      }

      const matches = [...html.matchAll(/href="\/library\/([^"?#]+)"/g)];
      const parsedNames = [
        ...new Set(
          matches
            .map(match => (typeof match[1] === 'string' ? decodeURIComponent(match[1]).trim() : ''))
            .filter(Boolean),
        ),
      ];

      const cloudMatches = [...cloudHtml.matchAll(/href="\/library\/([^"?#:]+)"/gi)];
      const cloudNames = [
        ...new Set(
          cloudMatches
            .map(match => (typeof match[1] === 'string' ? decodeURIComponent(match[1]).trim() : ''))
            .filter(Boolean),
        ),
      ];
      this.cloudCatalogNames = new Set(cloudNames.map(name => name.toLowerCase()));

      const filteredNames = parsedNames.filter(name => {
        const normalized = name.toLowerCase();
        // Exclude variant-style names (e.g., llama3.2:1b) from the top-level list
        if (normalized.includes(':')) {
          return false;
        }
        return true;
      });

      // Merge explicit cloud catalog families so "cloud" filtering works in Library.
      const mergedNames = [...new Set([...filteredNames, ...cloudNames])];

      if (mergedNames.length === 0) {
        throw new Error('No model names parsed from library page');
      }

      const limitedNames = mergedNames.slice(0, 200);
      this.logChannel?.info(`[client] library loaded with ${limitedNames.length} models`);
      return limitedNames;
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildItems(names: string[]): ModelTreeItem[] {
    const sortedNames = this.sortNames(names);

    const items = sortedNames.map(name => {
      const item = new ModelTreeItem(name, 'library-model');
      const isCloudCatalogModel = this.cloudCatalogNames.has(name.toLowerCase());
      if (isCloudCatalogModel) {
        item.description = '☁️';
      }
      item.tooltip = isCloudCatalogModel ? `Library model: ${name}\n☁️ Cloud` : `Library model: ${name}`;
      // Fetch description and capabilities asynchronously
      getCachedModelPagePreview(name).then(
        preview => {
          const tooltipLines = [`🤖 ${name}`];
          if (isCloudCatalogModel) {
            tooltipLines.push('☁️ Cloud');
          }
          const capLine = buildCapabilityLines(preview.capabilities);
          if (capLine) {
            tooltipLines.push(capLine);
          }
          if (preview.description) tooltipLines.push(preview.description);

          const badges: string[] = [];
          if (isCloudCatalogModel) badges.push('☁️');
          if (preview.capabilities.thinking || isThinkingModelId(name)) badges.push('🧠');
          if (preview.capabilities.tools) badges.push('🛠️');
          if (preview.capabilities.vision) badges.push('👁️');
          if (preview.capabilities.embedding) badges.push('🧩');
          // No 👍 badge here: base model names have no size tag so we
          // cannot determine fit.  The badge appears on individual variants.
          if (badges.length > 0) {
            item.description = badges.join(' ');
          }

          updateItemTooltip(item, tooltipLines.join('\n'), this.treeChangeEmitter);
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
      assertHtmlContentType(response);

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
      reportError(this.logChannel, 'Failed to fetch model variants', error, { showToUser: false });
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private startAutoRefresh(): void {
    // Intentionally no periodic auto-refresh for library metadata.
    // Library cache refreshes only on extension startup (initial fetch or hydrated storage)
    // and explicit manual refresh command.
  }
}

/**
 * Cloud models view provider (login-first via `ollama login`)
 */
export class CloudModelsProvider implements TreeDataProvider<ModelTreeItem>, Disposable {
  private treeChangeEmitter = new EventEmitter<ModelTreeItem | null>();
  readonly onDidChangeTreeData: Event<ModelTreeItem | null> = this.treeChangeEmitter.event;

  filterText = '';
  grouped = true;
  capabilityFilters: Set<string> = new Set();

  private cache: ModelTreeItem[] = [];
  private cacheTimeMs = 0;
  private loadPromise: Promise<ModelTreeItem[]> | null = null;
  private refreshIntervals: NodeJS.Timeout[] = [];
  private cachedNames = new Set<string>();
  private warmedModelNames = new Set<string>();
  private warmedModelResolvedNames = new Map<string, string>();
  private catalogModelNames: string[] = [];
  private cloudCapabilitiesByBase = new Map<string, Set<string>>();

  private static readonly CLOUD_CATALOG_STORAGE_KEY = 'ollama.cloudCatalogCache.v1';
  private static readonly CLOUD_CATALOG_CACHE_VERSION = 1;

  constructor(
    private context: ExtensionContext,
    private logChannel?: DiagnosticsLogger,
  ) {
    this.hydrateCloudCatalogFromStorage();
    this.startAutoRefresh();
  }

  getTreeItem(element: ModelTreeItem): TreeItem {
    return element;
  }

  async getChildren(element?: ModelTreeItem): Promise<ModelTreeItem[]> {
    if (!element) {
      const models = await this.getCloudModels();
      if (models.length === 1 && models[0].type === 'status') return models;
      if (models.length === 0) return [makeStatusItem('No cloud models found')];
      if (!this.grouped) return this.getCloudChildrenFlat(models);
      return this.getCloudChildrenGrouped(models);
    }

    if (element.type === 'model-group') {
      const allModels = await this.getCloudModels();
      return allModels
        .filter(m => m.type !== 'status' && extractModelFamily(m.label) === element.label)
        .sort((a, b) => a.label.localeCompare(b.label));
    }

    return [];
  }

  private getCloudChildrenFlat(models: ModelTreeItem[]): ModelTreeItem[] {
    const filterLower = this.filterText.toLowerCase();
    return models
      .filter(
        m =>
          m.type !== 'status' &&
          (!filterLower ||
            m.label.toLowerCase().includes(filterLower) ||
            (typeof m.tooltip === 'string' && m.tooltip.toLowerCase().includes(filterLower))) &&
          this.modelMatchesCapabilityFilters(m.label),
      )
      .sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()));
  }

  private getCloudChildrenGrouped(models: ModelTreeItem[]): ModelTreeItem[] {
    const groups = groupModelsByFamily(models);
    const filterLower = this.filterText.toLowerCase();

    const filteredEntries = Array.from(groups.entries())
      .filter(
        ([familyName, familyModels]) =>
          (!filterLower ||
            familyName.toLowerCase().includes(filterLower) ||
            familyModels.some(
              m =>
                m.label.toLowerCase().includes(filterLower) ||
                (typeof m.tooltip === 'string' && m.tooltip.toLowerCase().includes(filterLower)),
            )) &&
          (this.capabilityFilters.size === 0 || familyModels.some(m => this.modelMatchesCapabilityFilters(m.label))),
      )
      .sort((a, b) => a[0].localeCompare(b[0]));

    const result: ModelTreeItem[] = [];
    for (const [familyName, familyModels] of filteredEntries) {
      const groupItem = new ModelTreeItem(familyName, 'model-group');
      const familyCaps = aggregateFamilyCapabilities(familyModels);
      const capLine = buildCapabilityLines({
        thinking: familyCaps.thinking,
        tools: familyCaps.tools,
        vision: familyCaps.vision,
        embedding: familyCaps.embedding,
      });

      const badges: string[] = [];
      if (familyCaps.thinking) badges.push('🧠');
      if (familyCaps.tools) badges.push('🛠️');
      if (familyCaps.vision) badges.push('👁️');
      if (familyCaps.embedding) badges.push('🧩');
      if (badges.length > 0) groupItem.description = badges.join(' ');

      const tooltipLines = [`${familyName} family (${familyModels.length} models)`];
      if (capLine) tooltipLines.push(capLine);
      groupItem.tooltip = tooltipLines.join('\n');
      result.push(groupItem);
    }
    return result;
  }

  refresh(): void {
    this.cache = [];
    this.cacheTimeMs = 0;
    this.catalogModelNames = [];
    this.cloudCapabilitiesByBase.clear();
    this.context.globalState
      ?.update(CloudModelsProvider.CLOUD_CATALOG_STORAGE_KEY, undefined)
      ?.then(undefined, () => {});
    this.treeChangeEmitter.fire(null);
  }

  /**
   * Re-render the tree without clearing any cached data.
   * Use this when only the display mode changes (grouping, filtering) so we
   * don't trigger unnecessary network re-fetches.
   */
  softRefresh(): void {
    this.treeChangeEmitter.fire(null);
  }

  private cloudModelMatchesSingleFilter(filter: string, caps: Set<string> | undefined, modelName: string): boolean {
    if (filter === 'thinking') return caps ? caps.has('thinking') : isThinkingModelId(modelName);
    if (filter === 'tools') return !caps || caps.has('tools');
    if (filter === 'vision') return !caps || caps.has('vision');
    if (filter === 'embedding') return !caps || caps.has('embedding');
    return true;
  }

  private modelMatchesCapabilityFilters(modelName: string): boolean {
    if (this.capabilityFilters.size === 0) return true;
    const baseName = modelName.split(':')[0];
    const caps = this.cloudCapabilitiesByBase.get(baseName.toLowerCase());
    for (const filter of this.capabilityFilters) {
      if (!this.cloudModelMatchesSingleFilter(filter, caps, modelName)) return false;
    }
    return true;
  }

  getCachedModelNames(): Set<string> {
    return new Set(this.cachedNames);
  }

  getProfilingSnapshot(): {
    cachedItems: number;
    cachedNames: number;
    warmedModels: number;
    catalogModelNames: number;
    capabilitiesByBase: number;
    hasLoadPromise: boolean;
  } {
    return {
      cachedItems: this.cache.length,
      cachedNames: this.cachedNames.size,
      warmedModels: this.warmedModelNames.size,
      catalogModelNames: this.catalogModelNames.length,
      capabilitiesByBase: this.cloudCapabilitiesByBase.size,
      hasLoadPromise: this.loadPromise !== null,
    };
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
        const ct = response.headers?.get('content-type') ?? '';
        if (ct && !ct.toLowerCase().includes('text/html')) {
          // Non-HTML response (e.g. proxy error page) — skip scraping
          return `${modelName}:cloud`;
        }
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
    const runningInfoRefreshMs = 15 * 1000;
    if (this.cache.length > 0 && Date.now() - this.cacheTimeMs < runningInfoRefreshMs) {
      return this.cache;
    }

    if (this.loadPromise) {
      return this.loadPromise;
    }

    this.loadPromise = this.fetchCloudModels()
      .then(items => {
        this.cache = items;
        this.cacheTimeMs = Date.now();
        this.cachedNames = new Set(items.filter(item => item.type !== 'status').map(item => item.label));
        return items;
      })
      .catch(error => {
        reportError(this.logChannel, 'Cloud models fetch failed', error, { showToUser: false });
        return [makeStatusActionItem('Login to Ollama Cloud', 'opilot.loginCloud')];
      })
      .finally(() => {
        this.loadPromise = null;
      });

    return this.loadPromise;
  }

  private async fetchCloudModels(): Promise<ModelTreeItem[]> {
    let runningModels = new Map<string, { durationMs?: number; size?: number }>();
    try {
      runningModels = await this.fetchCloudRunningModels(8000);
    } catch (error) {
      reportError(this.logChannel, 'Failed to refresh cloud running status', error, { showToUser: false });
    }

    if (this.catalogModelNames.length === 0) {
      await this.loadCloudCatalogFromNetwork(12000);
    }

    if (this.catalogModelNames.length === 0) {
      return [makeStatusActionItem('Login to Ollama Cloud', 'opilot.loginCloud')];
    }

    const items = this.buildCloudItemsFromCatalog(runningModels);
    this.logChannel?.info(
      `[client] cloud models loaded: ${items.length} total, ${items.filter(m => m.type === 'cloud-running').length} running`,
    );
    return items.length > 0 ? items : [makeStatusItem('No cloud models found')];
  }

  private async fetchCloudRunningModels(
    _timeoutMs: number,
  ): Promise<Map<string, { durationMs?: number; size?: number }>> {
    const cloudClient = await getCloudOllamaClient(this.context);
    const psResponse = await cloudClient.ps();

    const runningModels = new Map<string, { durationMs?: number; size?: number }>();
    for (const model of psResponse.models ?? []) {
      if (!this.isCloudTaggedModel(model.name)) {
        continue;
      }

      const baseName = model.name.split(':')[0];
      const durationMs = model.expires_at ? Math.max(0, new Date(model.expires_at).getTime() - Date.now()) : undefined;
      runningModels.set(baseName, { durationMs, size: model.size });
    }

    // keep timeout parameter intentionally for parity with other fetchers
    return runningModels;
  }

  private async loadCloudCatalogFromNetwork(timeoutMs: number): Promise<void> {
    this.logChannel?.debug(`[client] fetching cloud model catalog (timeout=${timeoutMs}ms)`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const [tagsResponse, libraryResponse] = await Promise.all([
        fetch('https://ollama.com/api/tags', {
          method: 'GET',
          signal: controller.signal,
        }),
        fetch('https://ollama.com/search?c=cloud', {
          method: 'GET',
          signal: controller.signal,
        }),
      ]);

      const cloudModelNames: string[] = [];
      if (tagsResponse.ok && typeof tagsResponse.json === 'function') {
        const payload = (await tagsResponse.json()) as { models?: Array<{ name?: string }> };
        for (const model of payload.models ?? []) {
          if (typeof model.name === 'string' && model.name.trim()) {
            cloudModelNames.push(model.name.trim());
          }
        }
      }

      const cloudCapabilities = new Map<string, Set<string>>();
      if (libraryResponse.ok) {
        const html = await libraryResponse.text();
        const capBlockRe = /href="\/library\/([^"?#:]+)"[\s\S]*?(?=href="\/library\/|$)/gi;
        for (const block of html.matchAll(capBlockRe)) {
          const name = typeof block[1] === 'string' ? decodeURIComponent(block[1]).trim() : '';
          if (!name) continue;

          const key = name.toLowerCase();
          const caps = new Set<string>();
          const blockText = block[0];
          if (/\bTools\b/i.test(blockText)) caps.add('tools');
          if (/\bVision\b/i.test(blockText)) caps.add('vision');
          if (/\bThinking\b/i.test(blockText)) caps.add('thinking');
          if (/\bEmbedding\b/i.test(blockText)) caps.add('embedding');
          cloudCapabilities.set(key, caps);

          if (cloudModelNames.length === 0) {
            cloudModelNames.push(name);
          }
        }
      }

      const uniqueCloudModelNames = [...new Set(cloudModelNames)].sort((a, b) => a.localeCompare(b));
      this.catalogModelNames = uniqueCloudModelNames;
      this.cloudCapabilitiesByBase = cloudCapabilities;
      this.persistCloudCatalogToStorage();
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildSingleCloudItem(
    fullName: string,
    runningInfo: { durationMs?: number; size?: number } | undefined,
  ): ModelTreeItem {
    const baseName = fullName.split(':')[0];
    const isRunning =
      (typeof runningInfo?.durationMs === 'number' && runningInfo.durationMs > 0) ||
      this.warmedModelNames.has(baseName);
    const item = new ModelTreeItem(
      fullName,
      isRunning ? 'cloud-running' : 'cloud-stopped',
      runningInfo?.size,
      runningInfo?.durationMs,
    );
    item.command = {
      command: 'opilot.openModelSettingsForModel',
      title: 'Open Model Settings',
      arguments: [fullName],
    };

    const caps = this.cloudCapabilitiesByBase.get(baseName.toLowerCase());
    const isThinking = caps?.has('thinking') || isThinkingModelId(fullName);
    const hasTools = caps?.has('tools') ?? false;
    const hasVision = caps?.has('vision') ?? false;
    const hasEmbedding = caps?.has('embedding') ?? false;

    const badges: string[] = [];
    if (isThinking) badges.push('🧠');
    if (hasTools) badges.push('🛠️');
    if (hasVision) badges.push('👁️');
    if (hasEmbedding) badges.push('🧩');
    if (badges.length > 0) {
      const existing = (item.description ?? '').toString();
      const badgeStr = badges.join(' ');
      item.description = existing ? `${existing} ${badgeStr}` : badgeStr;
    }

    const sizeText = formatSizeForTooltip(runningInfo?.size);
    const tooltipLines = [`🤖 ${fullName}`, `🏋️ ${sizeText}`];
    if (isRunning) {
      const until = formatRelativeFromNow(runningInfo?.durationMs);
      tooltipLines.push(`⏱️ ${until}`);
    }
    const capLine = buildCapabilityLines({
      thinking: isThinking,
      tools: hasTools,
      vision: hasVision,
      embedding: hasEmbedding,
    });
    if (capLine) tooltipLines.push(capLine);
    item.tooltip = tooltipLines.join('\n');

    getCachedModelPagePreview(fullName).then(
      preview => {
        if (preview.description) {
          updateItemTooltip(item, `${item.tooltip as string}\n${preview.description}`, this.treeChangeEmitter);
        }
      },
      () => {
        /* keep existing tooltip */
      },
    );

    return item;
  }

  private buildCloudItemsFromCatalog(
    runningModels: Map<string, { durationMs?: number; size?: number }>,
  ): ModelTreeItem[] {
    return this.catalogModelNames
      .map(fullName => this.buildSingleCloudItem(fullName, runningModels.get(fullName.split(':')[0])))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  private hydrateCloudCatalogFromStorage(): void {
    const stored = this.context.globalState?.get<{
      version: number;
      names: string[];
      capabilitiesByBase: Record<string, string[]>;
    }>(CloudModelsProvider.CLOUD_CATALOG_STORAGE_KEY);

    if (!stored || stored.version !== CloudModelsProvider.CLOUD_CATALOG_CACHE_VERSION) {
      return;
    }

    this.catalogModelNames = Array.isArray(stored.names) ? [...new Set(stored.names.filter(Boolean))] : [];
    this.cloudCapabilitiesByBase.clear();
    if (stored.capabilitiesByBase && typeof stored.capabilitiesByBase === 'object') {
      for (const [baseName, caps] of Object.entries(stored.capabilitiesByBase)) {
        this.cloudCapabilitiesByBase.set(baseName, new Set((caps ?? []).filter(Boolean)));
      }
    }
  }

  private persistCloudCatalogToStorage(): void {
    const capabilitiesByBase: Record<string, string[]> = {};
    for (const [baseName, caps] of this.cloudCapabilitiesByBase.entries()) {
      capabilitiesByBase[baseName] = [...caps];
    }

    this.context.globalState
      ?.update(CloudModelsProvider.CLOUD_CATALOG_STORAGE_KEY, {
        version: CloudModelsProvider.CLOUD_CATALOG_CACHE_VERSION,
        names: this.catalogModelNames,
        capabilitiesByBase,
      })
      ?.then(undefined, () => {});
  }

  private isCloudTaggedModel(modelName: string): boolean {
    const tag = modelName.split(':')[1] ?? '';
    return tag === 'cloud' || tag.endsWith('-cloud');
  }

  private startAutoRefresh(): void {
    // Intentionally no periodic auto-refresh.
    // Cloud catalog is persisted and refreshed only on startup (if cache is empty)
    // or explicit manual refresh. Running state is refreshed lazily by getCloudModels().
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
 * Back-compat command handler: routes legacy API-key action to login flow.
 */
export async function handleManageCloudApiKey(
  _context: ExtensionContext,
  _cloudProvider: CloudModelsProvider,
  _libraryProvider: LibraryModelsProvider,
  _logChannel?: DiagnosticsLogger,
): Promise<void> {
  // Back-compat shim: old command now routes to login flow.
  handleLoginToCloud();
}

/**
 * Command handler: login to Ollama Cloud via terminal.
 *
 * ## Cloud authentication flow
 *
 * Ollama Cloud uses a session-based authentication model: the user logs in once
 * with `ollama login` using their Ollama.com credentials. The CLI stores an
 * opaque session token in the local Ollama config (typically `~/.ollama/`) and
 * the running Ollama server presents it automatically on cloud API calls.
 *
 * No API key is handled by this extension. The extension obtains a cloud-aware
 * Ollama client via `getCloudOllamaClient(context)` (see `src/client.ts`), which
 * currently resolves to the same local Ollama server endpoint as the standard
 * client — the server itself manages credential forwarding.
 *
 * Cloud model names carry a `:cloud` or `*-cloud` tag (e.g. `llama3.3:cloud`).
 * `CloudModelsProvider` discovers available cloud models by:
 * 1. Attempting to restore a cached catalog from `globalState` (version-gated).
 * 2. If the cache is empty, fetching the live catalog from
 *    `https://ollama.com/api/tags` (model names) and
 *    `https://ollama.com/search?c=cloud` (capabilities: tools/vision/thinking).
 * 3. Checking which cloud models are currently running via `ollama ps`.
 * 4. If the catalog fetch fails or returns nothing, the tree shows a
 *    "Login to Ollama Cloud" prompt that invokes this handler.
 *
 * The `handleManageCloudApiKey` command is a back-compat shim that also calls
 * this handler, replacing the old API-key entry UI.
 */
export function handleLoginToCloud(): void {
  const terminal = window.createTerminal({ name: 'Ollama Cloud Login' });
  terminal.show(true);
  terminal.sendText('ollama login', true);
}

/**
 * Command handler: open cloud model page
 */
export function handleOpenCloudModel(item: ModelTreeItem): void {
  if (item && (item.type === 'cloud-running' || item.type === 'cloud-stopped')) {
    Promise.resolve(env.openExternal(Uri.parse(getLibraryModelUrl(item.label)))).catch(() => {});
  }
}

/**
 * Command handler: delete model
 */
export async function handleDeleteModel(item: ModelTreeItem, localProvider: LocalModelsProvider): Promise<void> {
  if (item && (item.type === 'local-running' || item.type === 'cloud-running')) {
    Promise.resolve(window.showErrorMessage('Stop the model before deleting it.')).catch(() => {});
    return;
  }
  if (item && (item.type === 'local-stopped' || item.type === 'cloud-stopped')) {
    const answer = await window.showWarningMessage(`Delete model "${item.label}"?`, 'Delete', 'Cancel');
    if (answer === 'Delete') {
      Promise.resolve(localProvider.deleteModel(item.label)).catch(() => {});
    }
  }
}

export interface PullProgressTracker {
  lastCompleted: number;
  lastTotal: number;
}

export function computePullChunkProgress(
  total: number,
  completed: number,
  tracker: PullProgressTracker,
  progress: Progress<{ message?: string; increment?: number }>,
): void {
  if (total === tracker.lastTotal && completed < tracker.lastCompleted) {
    tracker.lastCompleted = 0;
  }
  const pct = Math.round((completed / total) * 100);
  const completedMb = (completed / 1024 / 1024).toFixed(1);
  const totalMb = (total / 1024 / 1024).toFixed(1);
  let increment = 0;
  if (total === tracker.lastTotal && tracker.lastCompleted > 0) {
    const delta = completed - tracker.lastCompleted;
    if (delta > 0) increment = Math.round((delta / total) * 100);
  }
  progress.report({ message: `${pct}% (${completedMb} / ${totalMb} MB)`, increment });
  tracker.lastCompleted = completed;
  tracker.lastTotal = total;
}

async function executePullDownload(
  client: Ollama,
  modelName: string,
  localProvider: LocalModelsProvider,
  progress: Progress<{ message?: string; increment?: number }>,
  token: CancellationToken,
  logChannel?: DiagnosticsLogger,
): Promise<void> {
  token.onCancellationRequested(() => {
    client.abort();
  });
  try {
    const stream = await client.pull({ model: modelName, stream: true });
    const tracker: PullProgressTracker = { lastCompleted: 0, lastTotal: 0 };
    for await (const chunk of stream) {
      const total = chunk.total ?? 0;
      const completed = chunk.completed ?? 0;
      if (total > 0) {
        computePullChunkProgress(total, completed, tracker, progress);
      } else if (chunk.status) {
        progress.report({ message: chunk.status });
      }
    }
    logChannel?.info(`[client] model pulled successfully: ${modelName}`);
    localProvider.refresh();
    window.showInformationMessage(`Model ${modelName} pulled successfully`);
  } catch (error) {
    if (token.isCancellationRequested) {
      window.showInformationMessage(`Download of ${modelName} cancelled`);
      return;
    }
    logChannel?.exception?.(`[client] failed to pull model ${modelName}`, error);
    const msg = error instanceof Error ? error.message : String(error);
    window.showErrorMessage(`Failed to pull model: ${msg}`);
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
    (progress, token) => executePullDownload(client, modelName, localProvider, progress, token, logChannel),
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
    Promise.resolve(env.openExternal(Uri.parse(getLibraryModelUrl(item.label)))).catch(() => {});
  }
}

/**
 * Command handler: start model
 */
export function handleStartModel(item: ModelTreeItem, localProvider: LocalModelsProvider): void {
  if (item && item.type === 'local-stopped') {
    Promise.resolve(localProvider.startModel(item.label)).catch(() => {});
  }
}

/**
 * Command handler: stop model
 */
export function handleStopModel(item: ModelTreeItem, localProvider: LocalModelsProvider): void {
  if (item && (item.type === 'local-running' || item.type === 'cloud-running')) {
    Promise.resolve(localProvider.stopModel(item.label)).catch(() => {});
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

export type SidebarProfilingSnapshot = {
  local: ReturnType<LocalModelsProvider['getProfilingSnapshot']>;
  library: ReturnType<LibraryModelsProvider['getProfilingSnapshot']>;
  cloud: ReturnType<CloudModelsProvider['getProfilingSnapshot']>;
  preview: ModelPreviewCacheSnapshot;
};

export type SidebarRegistration = {
  getProfilingSnapshot: () => SidebarProfilingSnapshot;
};

const CAPABILITY_FILTER_LABEL_TO_KEY = new Map([
  ['🧠 Thinking', 'thinking'],
  ['🛠️ Tools', 'tools'],
  ['👁️ Vision', 'vision'],
  ['🧩 Embedding', 'embedding'],
  ['✅ Downloaded', 'downloaded'],
  ['☁️ Cloud', 'cloud'],
]);

const MODEL_CAPABILITY_FILTER_LABEL_TO_KEY = new Map([
  ['🧠 Thinking', 'thinking'],
  ['🛠️ Tools', 'tools'],
  ['👁️ Vision', 'vision'],
  ['🧩 Embedding', 'embedding'],
]);

async function openLibraryCapabilityPicker(libraryProvider: LibraryModelsProvider): Promise<void> {
  const items = [...CAPABILITY_FILTER_LABEL_TO_KEY.entries()].map(([label, key]) => ({
    label,
    picked: libraryProvider.capabilityFilters.has(key),
  }));
  const selected = await window.showQuickPick(items, {
    canPickMany: true,
    placeHolder: 'Filter by capability — select one or more, confirm to apply',
    title: 'Filter Library by Capability',
  });
  if (selected === undefined) return;
  libraryProvider.capabilityFilters.clear();
  for (const item of selected) {
    const key = CAPABILITY_FILTER_LABEL_TO_KEY.get(item.label);
    if (key) libraryProvider.capabilityFilters.add(key);
  }
  const hasFilters = libraryProvider.capabilityFilters.size > 0;
  Promise.resolve(commands.executeCommand('setContext', 'ollama.libraryCapabilityFilterActive', hasFilters)).catch(
    () => {},
  );
  libraryProvider.refresh();
}

async function openLocalCapabilityPicker(localProvider: LocalModelsProvider): Promise<void> {
  const items = [...MODEL_CAPABILITY_FILTER_LABEL_TO_KEY.entries()].map(([label, key]) => ({
    label,
    picked: localProvider.capabilityFilters.has(key),
  }));
  const selected = await window.showQuickPick(items, {
    canPickMany: true,
    placeHolder: 'Filter by capability — select one or more, confirm to apply',
    title: 'Filter Local Models by Capability',
  });
  if (selected === undefined) return;
  localProvider.capabilityFilters.clear();
  for (const item of selected) {
    const key = MODEL_CAPABILITY_FILTER_LABEL_TO_KEY.get(item.label);
    if (key) localProvider.capabilityFilters.add(key);
  }
  const hasFilters = localProvider.capabilityFilters.size > 0;
  Promise.resolve(commands.executeCommand('setContext', 'ollama.localCapabilityFilterActive', hasFilters)).catch(
    () => {},
  );
  localProvider.softRefresh();
}

async function openCloudCapabilityPicker(cloudProvider: CloudModelsProvider): Promise<void> {
  const items = [...MODEL_CAPABILITY_FILTER_LABEL_TO_KEY.entries()].map(([label, key]) => ({
    label,
    picked: cloudProvider.capabilityFilters.has(key),
  }));
  const selected = await window.showQuickPick(items, {
    canPickMany: true,
    placeHolder: 'Filter by capability — select one or more, confirm to apply',
    title: 'Filter Cloud Models by Capability',
  });
  if (selected === undefined) return;
  cloudProvider.capabilityFilters.clear();
  for (const item of selected) {
    const key = MODEL_CAPABILITY_FILTER_LABEL_TO_KEY.get(item.label);
    if (key) cloudProvider.capabilityFilters.add(key);
  }
  const hasFilters = cloudProvider.capabilityFilters.size > 0;
  Promise.resolve(commands.executeCommand('setContext', 'ollama.cloudCapabilityFilterActive', hasFilters)).catch(
    () => {},
  );
  cloudProvider.softRefresh();
}

/**
 * Register sidebar with VS Code
 */
export function registerSidebar(
  context: ExtensionContext,
  client: Ollama,
  logChannel?: DiagnosticsLogger,
  onLocalModelsChanged?: () => void,
): SidebarRegistration {
  hydrateModelPreviewCacheFromStorage(context);

  let libraryProvider: LibraryModelsProvider | undefined;
  const localProvider = new LocalModelsProvider(client, context, logChannel, () => {
    onLocalModelsChanged?.();
    libraryProvider?.refreshVariantStates();
  });
  const cloudProvider = new CloudModelsProvider(context, logChannel);
  libraryProvider = new LibraryModelsProvider(logChannel);
  libraryProvider.attachContext(context);
  libraryProvider.setLocalProvider(localProvider);

  logChannel?.info('[client] sidebar providers initialized');

  const localTreeView = window.createTreeView('ollama-local-models', { treeDataProvider: localProvider });
  const libraryTreeView = window.createTreeView('ollama-library-models', { treeDataProvider: libraryProvider });
  const cloudTreeView = window.createTreeView('ollama-cloud-models', { treeDataProvider: cloudProvider });

  context.subscriptions.push(
    localTreeView,
    libraryTreeView,
    cloudTreeView,
    commands.registerCommand('opilot.collapseLocalModels', () =>
      commands.executeCommand('workbench.actions.treeView.ollama-local-models.collapseAll'),
    ),
    commands.registerCommand('opilot.collapseCloudModels', () =>
      commands.executeCommand('workbench.actions.treeView.ollama-cloud-models.collapseAll'),
    ),
    commands.registerCommand('opilot.collapseLibrary', () =>
      commands.executeCommand('workbench.actions.treeView.ollama-library-models.collapseAll'),
    ),
    commands.registerCommand('opilot.filterLocalModels', async () => {
      const value = await window.showInputBox({ prompt: 'Filter local models', value: localProvider.filterText });
      if (value !== undefined) {
        localProvider.filterText = value;
        Promise.resolve(commands.executeCommand('setContext', 'ollama.localFilterActive', value.length > 0)).catch(
          () => {},
        );
        localProvider.softRefresh();
      }
    }),
    commands.registerCommand('opilot.clearLocalFilter', () => {
      localProvider.filterText = '';
      Promise.resolve(commands.executeCommand('setContext', 'ollama.localFilterActive', false)).catch(() => {});
      localProvider.softRefresh();
    }),
    commands.registerCommand('opilot.filterLocalCapabilities', async () => {
      await openLocalCapabilityPicker(localProvider);
    }),
    commands.registerCommand('opilot.filterLocalCapabilitiesActive', async () => {
      await openLocalCapabilityPicker(localProvider);
    }),
    commands.registerCommand('opilot.filterCloudModels', async () => {
      const value = await window.showInputBox({ prompt: 'Filter cloud models', value: cloudProvider.filterText });
      if (value !== undefined) {
        cloudProvider.filterText = value;
        Promise.resolve(commands.executeCommand('setContext', 'ollama.cloudFilterActive', value.length > 0)).catch(
          () => {},
        );
        cloudProvider.softRefresh();
      }
    }),
    commands.registerCommand('opilot.clearCloudFilter', () => {
      cloudProvider.filterText = '';
      Promise.resolve(commands.executeCommand('setContext', 'ollama.cloudFilterActive', false)).catch(() => {});
      cloudProvider.softRefresh();
    }),
    commands.registerCommand('opilot.filterCloudCapabilities', async () => {
      await openCloudCapabilityPicker(cloudProvider);
    }),
    commands.registerCommand('opilot.filterCloudCapabilitiesActive', async () => {
      await openCloudCapabilityPicker(cloudProvider);
    }),
    commands.registerCommand('opilot.filterLibraryCapabilities', async () => {
      await openLibraryCapabilityPicker(libraryProvider);
    }),
    commands.registerCommand('opilot.filterLibraryCapabilitiesActive', async () => {
      await openLibraryCapabilityPicker(libraryProvider);
    }),
    commands.registerCommand('opilot.searchLibraryModels', async () => {
      const value = await window.showInputBox({ prompt: 'Search library models', value: libraryProvider.filterText });
      if (value !== undefined) {
        libraryProvider.filterText = value;
        Promise.resolve(commands.executeCommand('setContext', 'ollama.librarySearchActive', value.length > 0)).catch(
          () => {},
        );
        libraryProvider.refresh();
      }
    }),
    commands.registerCommand('opilot.clearLibrarySearch', () => {
      libraryProvider.filterText = '';
      Promise.resolve(commands.executeCommand('setContext', 'ollama.librarySearchActive', false)).catch(() => {});
      libraryProvider.refresh();
    }),
    (() => {
      const initialLocalGrouped = context.globalState.get<boolean>('ollama.localGrouped', true);
      localProvider.grouped = initialLocalGrouped;
      Promise.resolve(commands.executeCommand('setContext', 'ollama.localGrouped', initialLocalGrouped)).catch(
        () => {},
      );
      const toggleLocal = () => {
        localProvider.grouped = !localProvider.grouped;
        Promise.resolve(context.globalState.update('ollama.localGrouped', localProvider.grouped)).catch(() => {});
        Promise.resolve(commands.executeCommand('setContext', 'ollama.localGrouped', localProvider.grouped)).catch(
          () => {},
        );
        localProvider.refresh();
      };
      return commands.registerCommand('opilot.toggleLocalGrouping', toggleLocal);
    })(),
    commands.registerCommand('opilot.toggleLocalGroupingToTree', () => {
      Promise.resolve(commands.executeCommand('opilot.toggleLocalGrouping')).catch(() => {});
    }),
    (() => {
      const initialCloudGrouped = context.globalState.get<boolean>('ollama.cloudGrouped', true);
      cloudProvider.grouped = initialCloudGrouped;
      Promise.resolve(commands.executeCommand('setContext', 'ollama.cloudGrouped', initialCloudGrouped)).catch(
        () => {},
      );
      const toggleCloud = () => {
        cloudProvider.grouped = !cloudProvider.grouped;
        Promise.resolve(context.globalState.update('ollama.cloudGrouped', cloudProvider.grouped)).catch(() => {});
        Promise.resolve(commands.executeCommand('setContext', 'ollama.cloudGrouped', cloudProvider.grouped)).catch(
          () => {},
        );
        cloudProvider.softRefresh();
      };
      return commands.registerCommand('opilot.toggleCloudGrouping', toggleCloud);
    })(),
    commands.registerCommand('opilot.toggleCloudGroupingToTree', () => {
      Promise.resolve(commands.executeCommand('opilot.toggleCloudGrouping')).catch(() => {});
    }),
    (() => {
      const initialLibraryGrouped = context.globalState.get<boolean>('ollama.libraryGrouped', true);
      libraryProvider.grouped = initialLibraryGrouped;
      Promise.resolve(commands.executeCommand('setContext', 'ollama.libraryGrouped', initialLibraryGrouped)).catch(
        () => {},
      );
      const toggleLibrary = () => {
        libraryProvider.grouped = !libraryProvider.grouped;
        Promise.resolve(context.globalState.update('ollama.libraryGrouped', libraryProvider.grouped)).catch(() => {});
        Promise.resolve(commands.executeCommand('setContext', 'ollama.libraryGrouped', libraryProvider.grouped)).catch(
          () => {},
        );
        libraryProvider.softRefresh();
      };
      return commands.registerCommand('opilot.toggleLibraryGrouping', toggleLibrary);
    })(),
    commands.registerCommand('opilot.toggleLibraryGroupingToTree', () => {
      Promise.resolve(commands.executeCommand('opilot.toggleLibraryGrouping')).catch(() => {});
    }),
    (() => {
      const initialRecommendedOnly = context.globalState.get<boolean>('ollama.libraryRecommendedOnly', false);
      libraryProvider.recommendedOnly = initialRecommendedOnly;
      Promise.resolve(
        commands.executeCommand('setContext', 'ollama.libraryRecommendedOnly', initialRecommendedOnly),
      ).catch(() => {});
      const toggleRecommended = () => {
        libraryProvider.recommendedOnly = !libraryProvider.recommendedOnly;
        Promise.resolve(
          context.globalState.update('ollama.libraryRecommendedOnly', libraryProvider.recommendedOnly),
        ).catch(() => {});
        Promise.resolve(
          commands.executeCommand('setContext', 'ollama.libraryRecommendedOnly', libraryProvider.recommendedOnly),
        ).catch(() => {});
        libraryProvider.refresh();
      };
      return commands.registerCommand('opilot.toggleLibraryRecommended', toggleRecommended);
    })(),
    commands.registerCommand('opilot.toggleLibraryRecommendedOff', () => {
      Promise.resolve(commands.executeCommand('opilot.toggleLibraryRecommended')).catch(() => {});
    }),
    (() => {
      const initialLocalRecommendedOnly = context.globalState.get<boolean>('ollama.localRecommendedOnly', false);
      localProvider.recommendedOnly = initialLocalRecommendedOnly;
      Promise.resolve(
        commands.executeCommand('setContext', 'ollama.localRecommendedOnly', initialLocalRecommendedOnly),
      ).catch(() => {});
      const toggleLocalRecommended = () => {
        localProvider.recommendedOnly = !localProvider.recommendedOnly;
        Promise.resolve(context.globalState.update('ollama.localRecommendedOnly', localProvider.recommendedOnly)).catch(
          () => {},
        );
        Promise.resolve(
          commands.executeCommand('setContext', 'ollama.localRecommendedOnly', localProvider.recommendedOnly),
        ).catch(() => {});
        localProvider.softRefresh();
      };
      return commands.registerCommand('opilot.toggleLocalRecommended', toggleLocalRecommended);
    })(),
    commands.registerCommand('opilot.toggleLocalRecommendedOff', () => {
      Promise.resolve(commands.executeCommand('opilot.toggleLocalRecommended')).catch(() => {});
    }),
    commands.registerCommand('opilot.refreshSidebar', () => handleRefreshLocalModels(localProvider)),
    commands.registerCommand('opilot.refreshLocalModels', () => handleRefreshLocalModels(localProvider)),
    commands.registerCommand('opilot.refreshLibrary', () => handleRefreshLibrary(libraryProvider)),
    commands.registerCommand('opilot.refreshCloudModels', () => handleRefreshCloudModels(cloudProvider)),
    commands.registerCommand('opilot.manageCloudApiKey', async () =>
      handleManageCloudApiKey(context, cloudProvider, libraryProvider, logChannel),
    ),
    commands.registerCommand('opilot.loginCloud', () => handleLoginToCloud()),
    commands.registerCommand('opilot.openCloudModel', (item: ModelTreeItem) => handleOpenCloudModel(item)),
    commands.registerCommand('opilot.deleteModel', (item: ModelTreeItem) => handleDeleteModel(item, localProvider)),
    commands.registerCommand('opilot.pullModel', async () => handlePullModel(client, localProvider, logChannel)),
    commands.registerCommand('opilot.pullModelFromLibrary', async (item: ModelTreeItem) =>
      handlePullModelFromLibrary(item, client, localProvider, logChannel),
    ),
    commands.registerCommand('opilot.openLibraryModelPage', (item: ModelTreeItem) => handleOpenLibraryModelPage(item)),
    commands.registerCommand('opilot.startModel', (item: ModelTreeItem) => handleStartModel(item, localProvider)),
    commands.registerCommand('opilot.stopModel', (item: ModelTreeItem) => handleStopModel(item, localProvider)),
    commands.registerCommand('opilot.startCloudModel', (item: ModelTreeItem) =>
      handleStartCloudModel(item, localProvider, cloudProvider),
    ),
    commands.registerCommand('opilot.stopCloudModel', (item: ModelTreeItem) =>
      handleStopCloudModel(item, localProvider, cloudProvider),
    ),
    { dispose: () => localProvider.dispose() },
    { dispose: () => libraryProvider.dispose() },
    { dispose: () => cloudProvider.dispose() },
  );

  // Register language-model tools that operate on models (list/info/health/pull/start/stop).
  // We register here so the implementations can directly call the LocalModelsProvider
  // APIs (startModel/stopModel/deleteModel) and reuse the existing UI commands.
  try {
    // Import at runtime to avoid static circular dependency issues in builds/tests.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { registerOpilotLmTools } = require('./lmTools');
    registerOpilotLmTools(context, client, localProvider, logChannel);
  } catch (err) {
    logChannel?.exception?.('[sidebar] failed to register LM tools', err);
  }

  return {
    getProfilingSnapshot: () => ({
      local: localProvider.getProfilingSnapshot(),
      library: libraryProvider.getProfilingSnapshot(),
      cloud: cloudProvider.getProfilingSnapshot(),
      preview: getModelPreviewCacheSnapshot(),
    }),
  };
}
