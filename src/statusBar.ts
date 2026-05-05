import type { Ollama } from 'ollama';
import * as vscode from 'vscode';
import type { DiagnosticsLogger } from './diagnostics.js';
import { formatBytes } from './formatUtils.js';
import { affectsSetting, getSetting } from './settings.js';

/** Minimum poll interval enforced regardless of setting value (5 seconds). */
const MIN_INTERVAL_MS = 5_000;
const DEBOUNCE_FAILURE_COUNT = 2;

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

function getHeartbeatIntervalMs(): number {
  const seconds = getSetting<number>('localModelRefreshInterval', 30);
  return Math.max(seconds * 1_000, MIN_INTERVAL_MS);
}

export type StatusBarState = 'checking' | 'online' | 'offline';

/**
 * Per-model resource usage from ps().
 */
export interface RunningModelInfo {
  name: string;
  /** Total memory footprint in bytes. */
  size: number;
  /** VRAM footprint in bytes (0 = CPU-only). */
  sizeVram: number;
}

/**
 * Result of a single Ollama health check.
 */
export interface HealthCheckResult {
  online: boolean;
  /** Number of models currently loaded in memory (from ps()). */
  runningCount: number;
  /** Individual running model info. */
  runningModels: RunningModelInfo[];
  host: string;
  checkedAt: Date;
}

/**
 * Perform a single health check against the Ollama server.
 * Uses ps() to get running models and their resource usage.
 * Returns structured result rather than throwing so callers don't need try/catch.
 */
export async function checkOllamaHealth(client: Ollama, host: string): Promise<HealthCheckResult> {
  const checkedAt = new Date();
  try {
    const { models } = await client.ps();
    const runningModels: RunningModelInfo[] = models.map(m => ({
      name: m.name,
      size: getNumberField(m, 'size') ?? 0,
      sizeVram: getNumberField(m, 'size_vram') ?? 0,
    }));
    return { online: true, runningCount: runningModels.length, runningModels, host, checkedAt };
  } catch (error) {
    // Only fall back to list() for HTTP 4xx errors (e.g. Ollama Cloud returns 404/405
    // for the ps() endpoint). Network-level failures (ECONNREFUSED, ETIMEDOUT) mean
    // the server is genuinely unreachable — skip the extra round-trip.
    const isHttpError =
      error !== null &&
      typeof error === 'object' &&
      'status_code' in error &&
      typeof (error as { status_code: unknown }).status_code === 'number' &&
      (error as { status_code: number }).status_code >= 400 &&
      (error as { status_code: number }).status_code < 500;

    if (isHttpError) {
      try {
        await client.list();
        return { online: true, runningCount: 0, runningModels: [], host, checkedAt };
      } catch {
        return { online: false, runningCount: 0, runningModels: [], host, checkedAt };
      }
    }

    return { online: false, runningCount: 0, runningModels: [], host, checkedAt };
  }
}

/**
 * Format a Date as a short locale time string (e.g. "14:03:22").
 */
function formatTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function buildOnlineTooltip(result: HealthCheckResult): vscode.MarkdownString {
  const lines: string[] = [`🦙 **Ollama** — connected`, ``, `Host: \`${result.host}\``];

  if (result.runningCount === 0) {
    lines.push(`\nRunning: none`);
  } else {
    lines.push(`| Model | Memory | Processor |`);
    lines.push(`| --- | --- | --- |`);
    for (const m of result.runningModels) {
      const gpuPct = m.size > 0 ? Math.round((m.sizeVram / m.size) * 100) : 0;
      const processor = m.size > 0 ? (gpuPct > 0 ? `${gpuPct}% GPU` : 'CPU') : '—';
      lines.push(`| ${m.name} | ${m.size > 0 ? formatBytes(m.size) : '—'} | ${processor} |`);
    }
  }

  lines.push(``, `Checked: ${formatTime(result.checkedAt)}`);

  const md = new vscode.MarkdownString(lines.join(`\n`));
  md.supportHtml = false;
  return md;
}

export interface HealthDebounceState {
  consecutiveFailures: number;
  lastApplied: HealthCheckResult | undefined;
}

export function applyHealthResult(
  result: HealthCheckResult,
  state: HealthDebounceState,
  item: vscode.StatusBarItem,
): void {
  if (!result.online) {
    state.consecutiveFailures++;
  } else {
    state.consecutiveFailures = 0;
  }

  if (result.online || state.consecutiveFailures >= DEBOUNCE_FAILURE_COUNT) {
    state.lastApplied = result;
    applyState(item, result);
  } else if (state.lastApplied !== undefined) {
    applyState(item, state.lastApplied);
  }
}

function applyState(item: vscode.StatusBarItem, result: HealthCheckResult): void {
  if (result.online) {
    item.text = result.runningCount > 0 ? `$(pulse) Ollama (${result.runningCount})` : `$(pulse) Ollama`;
    item.tooltip = buildOnlineTooltip(result);
    item.backgroundColor = undefined;
    item.color = undefined;
  } else {
    item.text = `$(warning) Ollama offline`;
    item.tooltip = new vscode.MarkdownString(
      `**Ollama** — unreachable\n\nHost: \`${result.host}\`\nChecked: ${formatTime(result.checkedAt)}\n\nClick to open connection settings.`,
    );
    item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    item.color = new vscode.ThemeColor('statusBarItem.warningForeground');
  }
}

export type StatusBarHeartbeatRegistration = {
  dispose: () => void;
  triggerCheck: () => void;
};

/**
 * Register the Ollama status bar heartbeat.
 *
 * Returns an object with `dispose()` to stop polling and `triggerCheck()` to
 * force an immediate health check (useful after starting/stopping models).
 */
export function registerStatusBarHeartbeat(
  client: Ollama,
  host: string,
  diagnostics: DiagnosticsLogger,
): StatusBarHeartbeatRegistration {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  item.command = 'opilot.checkServerHealth';
  item.text = `$(loading~spin) Ollama…`;
  item.tooltip = 'Checking Ollama server…';
  item.show();

  const debounce: HealthDebounceState = { consecutiveFailures: 0, lastApplied: undefined };
  let intervalHandle: ReturnType<typeof setInterval> | undefined;
  /** Monotonically increasing ID; only the latest check's result is applied. */
  let currentRequestId = 0;

  const runCheck = async () => {
    const requestId = ++currentRequestId;
    const result = await checkOllamaHealth(client, host);

    // Discard stale results when a newer check was triggered concurrently.
    if (requestId !== currentRequestId) return;

    diagnostics.debug(
      `[statusBar] health check: ${result.online ? `online, ${result.runningCount} running` : 'offline'}`,
    );

    applyHealthResult(result, debounce, item);
  };

  const scheduleInterval = () => {
    if (intervalHandle !== undefined) clearInterval(intervalHandle);
    intervalHandle = setInterval(() => void runCheck(), getHeartbeatIntervalMs());
  };

  // Initial check immediately, then start interval.
  void runCheck();
  scheduleInterval();

  // Re-schedule if the refresh interval setting changes.
  const configListener = vscode.workspace.onDidChangeConfiguration(event => {
    if (affectsSetting(event, 'localModelRefreshInterval')) {
      diagnostics.debug('[statusBar] refresh interval changed, rescheduling heartbeat');
      scheduleInterval();
    }
  });

  return {
    dispose: () => {
      if (intervalHandle !== undefined) clearInterval(intervalHandle);
      configListener.dispose();
      item.dispose();
    },
    triggerCheck: () => {
      void runCheck();
    },
  };
}
