import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── vscode mock ──────────────────────────────────────────────────────────────

const mockStatusBarItem = {
  text: '',
  tooltip: undefined as unknown,
  backgroundColor: undefined as unknown,
  color: undefined as unknown,
  command: undefined as unknown,
  show: vi.fn(),
  dispose: vi.fn(),
};

const onDidChangeConfigurationListeners: Array<(e: { affectsConfiguration: (s: string) => boolean }) => void> = [];

vi.mock('vscode', () => ({
  window: {
    createStatusBarItem: vi.fn(() => mockStatusBarItem),
  },
  StatusBarAlignment: { Right: 2 },
  MarkdownString: class {
    constructor(public value: string) {}
  },
  ThemeColor: class {
    constructor(public id: string) {}
  },
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn((key: string) => {
        if (key === 'localModelRefreshInterval') return 30;
        return undefined;
      }),
    })),
    onDidChangeConfiguration: vi.fn((cb: (e: { affectsConfiguration: (s: string) => boolean }) => void) => {
      onDidChangeConfigurationListeners.push(cb);
      return { dispose: vi.fn() };
    }),
  },
}));

// ── tests ────────────────────────────────────────────────────────────────────

import type { Ollama } from 'ollama';
import { checkOllamaHealth, registerStatusBarHeartbeat } from './statusBar.js';

/** Flush the microtask queue so async chains (like await client.ps()) complete.
 * Each `await Promise.resolve()` processes one tick — 5 ticks covers a 3-level deep chain.
 * Does NOT use setTimeout so it's safe with vi.useFakeTimers(). */
const flushPromises = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
};

const noopLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  exception: vi.fn(),
};

function makeClient(
  models: Array<{ name: string; size?: number; size_vram?: number }> = [
    { name: 'llama3.2', size: 4_000_000_000, size_vram: 4_000_000_000 },
  ],
): Ollama {
  return {
    ps: vi.fn().mockResolvedValue({ models }),
  } as unknown as Ollama;
}

describe('checkOllamaHealth', () => {
  it('returns online=true with running model count when ps() succeeds', async () => {
    const client = makeClient([
      { name: 'llama3.2', size: 4_000_000_000, size_vram: 4_000_000_000 },
      { name: 'gemma3', size: 2_000_000_000, size_vram: 0 },
    ]);
    const result = await checkOllamaHealth(client, 'http://localhost:11434');

    expect(result.online).toBe(true);
    expect(result.runningCount).toBe(2);
    expect(result.runningModels).toHaveLength(2);
    expect(result.runningModels[0].name).toBe('llama3.2');
    expect(result.runningModels[0].size).toBe(4_000_000_000);
    expect(result.runningModels[0].sizeVram).toBe(4_000_000_000);
    expect(result.runningModels[1].sizeVram).toBe(0);
    expect(result.host).toBe('http://localhost:11434');
    expect(result.checkedAt).toBeInstanceOf(Date);
  });

  it('returns online=false when ps() throws', async () => {
    const client = {
      ps: vi.fn().mockRejectedValue(new Error('connection refused')),
    } as unknown as Ollama;
    const result = await checkOllamaHealth(client, 'http://localhost:11434');

    expect(result.online).toBe(false);
    expect(result.runningCount).toBe(0);
    expect(result.runningModels).toHaveLength(0);
  });

  it('returns online=true with zero running models when no models are loaded', async () => {
    const client = makeClient([]);
    const result = await checkOllamaHealth(client, 'http://localhost:11434');

    expect(result.online).toBe(true);
    expect(result.runningCount).toBe(0);
  });
});

describe('registerStatusBarHeartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    onDidChangeConfigurationListeners.length = 0;
    mockStatusBarItem.text = '';
    mockStatusBarItem.tooltip = undefined;
    mockStatusBarItem.backgroundColor = undefined;
    mockStatusBarItem.color = undefined;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows status bar item immediately on registration', () => {
    const client = makeClient();
    registerStatusBarHeartbeat(client, 'http://localhost:11434', noopLogger);
    expect(mockStatusBarItem.show).toHaveBeenCalled();
  });

  it('sets command to opilot.checkServerHealth', () => {
    const client = makeClient();
    registerStatusBarHeartbeat(client, 'http://localhost:11434', noopLogger);
    expect(mockStatusBarItem.command).toBe('opilot.checkServerHealth');
  });

  it('displays loading state synchronously before first check resolves', () => {
    const client = makeClient();
    registerStatusBarHeartbeat(client, 'http://localhost:11434', noopLogger);
    // Before the promise resolves, should show loading spinner
    expect(mockStatusBarItem.text).toContain('loading~spin');
  });

  it('updates to online state after first check succeeds', async () => {
    const client = makeClient([
      { name: 'llama3.2', size: 4_000_000_000, size_vram: 4_000_000_000 },
      { name: 'gemma3', size: 2_000_000_000, size_vram: 0 },
    ]);
    registerStatusBarHeartbeat(client, 'http://localhost:11434', noopLogger);
    await flushPromises();

    expect(mockStatusBarItem.text).toContain('pulse');
    expect(mockStatusBarItem.text).toContain('2');
    expect(mockStatusBarItem.backgroundColor).toBeUndefined();
  });

  it('shows combined memory and GPU/CPU pressure in tooltip', async () => {
    const client = makeClient([
      { name: 'llama3.2', size: 4_000_000_000, size_vram: 4_000_000_000 },
      { name: 'gemma3', size: 2_000_000_000, size_vram: 0 },
    ]);
    registerStatusBarHeartbeat(client, 'http://localhost:11434', noopLogger);
    await flushPromises();

    const tooltip = mockStatusBarItem.tooltip as { value: string };
    expect(tooltip.value).toContain('GB');
    // llama3.2: 100% GPU, gemma3: CPU only
    expect(tooltip.value).toContain('GPU');
    expect(tooltip.value).toContain('llama3.2');
    expect(tooltip.value).toContain('gemma3');
  });

  it('shows "none" in tooltip when server is online but no models running', async () => {
    const client = makeClient([]);
    registerStatusBarHeartbeat(client, 'http://localhost:11434', noopLogger);
    await flushPromises();

    expect(mockStatusBarItem.text).toBe('$(pulse) Ollama');
    const tooltip = mockStatusBarItem.tooltip as { value: string };
    expect(tooltip.value).toContain('none');
  });

  it('does NOT flip to offline on first single failure (debounce)', async () => {
    const client = {
      ps: vi.fn().mockRejectedValue(new Error('connection refused')),
    } as unknown as Ollama;

    registerStatusBarHeartbeat(client, 'http://localhost:11434', noopLogger);
    await flushPromises();

    expect(mockStatusBarItem.text).not.toContain('warning');
  });

  it('shows offline state after 2 consecutive failures (debounce threshold)', async () => {
    const client = {
      ps: vi.fn().mockRejectedValue(new Error('connection refused')),
    } as unknown as Ollama;

    registerStatusBarHeartbeat(client, 'http://localhost:11434', noopLogger);

    // First tick (initial call)
    await flushPromises();
    // Second tick — advance timer past interval, triggering 2nd failure
    vi.advanceTimersByTime(30_000);
    await flushPromises();

    expect(mockStatusBarItem.text).toContain('warning');
    expect(mockStatusBarItem.text).toContain('offline');
  });

  it('resets to online state after consecutive failures then a success', async () => {
    const ps = vi
      .fn()
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValue({ models: [{ name: 'llama3.2', size: 4_000_000_000, size_vram: 4_000_000_000 }] });

    const client = { ps } as unknown as Ollama;
    registerStatusBarHeartbeat(client, 'http://localhost:11434', noopLogger);

    // First two failures
    await flushPromises();
    vi.advanceTimersByTime(30_000);
    await flushPromises();
    expect(mockStatusBarItem.text).toContain('warning');

    // Recovery
    vi.advanceTimersByTime(30_000);
    await flushPromises();
    expect(mockStatusBarItem.text).toContain('pulse');
    expect(mockStatusBarItem.backgroundColor).toBeUndefined();
  });

  it('disposes status bar item and stops polling on dispose()', async () => {
    const client = makeClient();
    const disposable = registerStatusBarHeartbeat(client, 'http://localhost:11434', noopLogger);
    await flushPromises();

    disposable.dispose();
    expect(mockStatusBarItem.dispose).toHaveBeenCalled();

    // No more ps() calls after dispose
    const callsBefore = (client.ps as ReturnType<typeof vi.fn>).mock.calls.length;
    vi.advanceTimersByTime(60_000);
    await flushPromises();
    expect((client.ps as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore);
  });
});
