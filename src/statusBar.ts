import type { Ollama } from 'ollama';
import * as vscode from 'vscode';
import type { DiagnosticsLogger } from './diagnostics.js';

/** Minimum poll interval enforced regardless of setting value (5 seconds). */
const MIN_INTERVAL_MS = 5_000;
const DEBOUNCE_FAILURE_COUNT = 2;

function getHeartbeatIntervalMs(): number {
  const seconds = vscode.workspace.getConfiguration('ollama').get<number>('localModelRefreshInterval') ?? 30;
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

/** Format bytes as a human-readable string (e.g. "3.72 GB"). */
function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
  if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
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
    const runningModels: RunningModelInfo[] = models.map(m => {
      const rec = m as unknown as Record<string, unknown>;
      return {
        name: m.name,
        size: typeof rec.size === 'number' ? rec.size : 0,
        sizeVram: typeof rec.size_vram === 'number' ? rec.size_vram : 0,
      };
    });
    return { online: true, runningCount: runningModels.length, runningModels, host, checkedAt };
  } catch {
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

  let consecutiveFailures = 0;
  let intervalHandle: ReturnType<typeof setInterval> | undefined;
  /** Monotonically increasing ID; only the latest check's result is applied. */
  let currentRequestId = 0;
  /** The last result that was applied to the status bar. */
  let lastApplied: HealthCheckResult | undefined;

  const runCheck = async () => {
    const requestId = ++currentRequestId;
    const result = await checkOllamaHealth(client, host);

    // Discard stale results when a newer check was triggered concurrently.
    if (requestId !== currentRequestId) return;

    diagnostics.debug(
      `[statusBar] health check: ${result.online ? `online, ${result.runningCount} running` : 'offline'}`,
    );

    if (!result.online) {
      consecutiveFailures++;
    } else {
      consecutiveFailures = 0;
    }

    // Only flip to offline display after DEBOUNCE_FAILURE_COUNT consecutive failures
    // to avoid flicker on transient network errors.
    if (result.online || consecutiveFailures >= DEBOUNCE_FAILURE_COUNT) {
      lastApplied = result;
      applyState(item, result);
    } else if (lastApplied !== undefined) {
      // Re-apply last known state so the loading spinner doesn't stay visible.
      applyState(item, lastApplied);
    }
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
    if (event.affectsConfiguration('ollama.localModelRefreshInterval')) {
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
