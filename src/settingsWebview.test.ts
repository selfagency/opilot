import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  commands: {
    executeCommand: vi.fn().mockResolvedValue(undefined),
  },
}));

import {
  THINKING_MODEL_PATTERN,
  MODEL_SETTINGS_VIEW_ID,
  ModelSettingsViewProvider,
  createModelSettingsViewProvider,
  mergeSettings,
  sanitizePatch,
} from './settingsWebview.js';
import type { ModelSettingsStore } from './modelSettings.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProvider(overrides: Partial<ConstructorParameters<typeof ModelSettingsViewProvider>[0]> = {}) {
  return new ModelSettingsViewProvider({
    context: { extensionUri: {} } as never,
    initialStore: {},
    getAvailableModels: vi.fn().mockResolvedValue(['llama3.2:latest', 'qwen3:0.6b']),
    onStoreChanged: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  });
}

function makeWebviewView() {
  const messageHandlers: Array<(msg: unknown) => void | Promise<void>> = [];
  const disposeHandlers: Array<() => void> = [];
  return {
    webview: {
      options: {} as never,
      html: '',
      cspSource: 'vscode-resource:',
      postMessage: vi.fn().mockResolvedValue(true),
      onDidReceiveMessage: vi.fn((handler: (msg: unknown) => void) => {
        messageHandlers.push(handler);
        return { dispose: vi.fn() };
      }),
    },
    show: vi.fn(),
    onDidDispose: vi.fn((handler: () => void) => {
      disposeHandlers.push(handler);
      return { dispose: vi.fn() };
    }),
    async fire(msg: unknown) {
      for (const h of messageHandlers) await h(msg);
    },
    triggerDispose() {
      for (const h of disposeHandlers) h();
    },
  };
}

// Flush microtask queue so void-returned async functions complete
const flushMicrotasks = () => new Promise<void>(resolve => setTimeout(resolve, 0));

// ---------------------------------------------------------------------------
// THINKING_MODEL_PATTERN
// ---------------------------------------------------------------------------

describe('THINKING_MODEL_PATTERN', () => {
  const matching = [
    'qwen3',
    'qwen3:0.6b',
    'qwen3:32b',
    'qwq:latest',
    'qwq-32b',
    'deepseek-r1:latest',
    'deepseekr1',
    'deepseek-r1:7b',
    'cogito:8b',
    'cogito:latest',
    'phi4-reasoning',
    'phi3-reasoning:latest',
    'phi5-reasoning:3b',
    'kimi:1.5b',
    'kimi:latest',
    'thinking-model',
    'my-thinking-assistant',
    'Qwen3:0.6b', // case insensitive
    'THINKING',
  ];

  const nonMatching = [
    'llama3.2:latest',
    'llama3.1:70b',
    'mistral:latest',
    'gemma2:9b',
    'codestral',
    'nomic-embed-text',
    'llava:13b',
    'starcoder2:3b',
    'phi3:latest', // phi without reasoning suffix
    'phi4:latest',
    'deepseek-coder:latest', // deepseek without r1
  ];

  for (const model of matching) {
    it(`matches "${model}"`, () => {
      expect(THINKING_MODEL_PATTERN.test(model)).toBe(true);
    });
  }

  for (const model of nonMatching) {
    it(`does not match "${model}"`, () => {
      expect(THINKING_MODEL_PATTERN.test(model)).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// sanitizePatch
// ---------------------------------------------------------------------------

describe('sanitizePatch', () => {
  it('returns empty object for null', () => {
    expect(sanitizePatch(null)).toEqual({});
  });

  it('returns empty object for undefined', () => {
    expect(sanitizePatch(undefined)).toEqual({});
  });

  it('returns empty object for a string', () => {
    expect(sanitizePatch('hello')).toEqual({});
  });

  it('returns empty object for an array', () => {
    expect(sanitizePatch([1, 2, 3])).toEqual({});
  });

  it('returns empty object for an empty object', () => {
    expect(sanitizePatch({})).toEqual({});
  });

  it('accepts all valid numeric fields', () => {
    expect(
      sanitizePatch({
        temperature: 0.5,
        top_p: 0.9,
        top_k: 40,
        num_ctx: 4096,
        num_predict: -1,
        think_budget: 2048,
      }),
    ).toEqual({ temperature: 0.5, top_p: 0.9, top_k: 40, num_ctx: 4096, num_predict: -1, think_budget: 2048 });
  });

  it('accepts think: true', () => {
    expect(sanitizePatch({ think: true })).toEqual({ think: true });
  });

  it('accepts think: false', () => {
    expect(sanitizePatch({ think: false })).toEqual({ think: false });
  });

  it('rejects string temperature', () => {
    expect(sanitizePatch({ temperature: '0.5' })).toEqual({});
  });

  it('rejects NaN temperature', () => {
    expect(sanitizePatch({ temperature: NaN })).toEqual({});
  });

  it('rejects Infinity temperature', () => {
    expect(sanitizePatch({ temperature: Infinity })).toEqual({});
  });

  it('rejects -Infinity', () => {
    expect(sanitizePatch({ top_p: -Infinity })).toEqual({});
  });

  it('rejects string think', () => {
    expect(sanitizePatch({ think: 'yes' })).toEqual({});
  });

  it('rejects numeric think', () => {
    expect(sanitizePatch({ think: 1 })).toEqual({});
  });

  it('ignores unknown keys', () => {
    expect(sanitizePatch({ temperature: 0.5, unknown: 'blah', extra: 42 })).toEqual({ temperature: 0.5 });
  });

  it('handles partial valid patches', () => {
    expect(sanitizePatch({ temperature: 0.3, top_k: 'bad', num_ctx: 8192 })).toEqual({
      temperature: 0.3,
      num_ctx: 8192,
    });
  });

  it('accepts zero for numeric fields', () => {
    expect(sanitizePatch({ temperature: 0, top_p: 0, top_k: 0, think_budget: 0 })).toEqual({
      temperature: 0,
      top_p: 0,
      top_k: 0,
      think_budget: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// mergeSettings
// ---------------------------------------------------------------------------

describe('mergeSettings', () => {
  it('creates a new model entry from an empty store', () => {
    const result = mergeSettings({}, 'llama3.2:latest', { temperature: 0.5 });
    expect(result).toEqual({ 'llama3.2:latest': { temperature: 0.5 } });
  });

  it('merges a patch into an existing model entry', () => {
    const store: ModelSettingsStore = { 'llama3.2:latest': { temperature: 0.8, top_p: 0.9 } };
    const result = mergeSettings(store, 'llama3.2:latest', { temperature: 0.3 });
    expect(result['llama3.2:latest']).toEqual({ temperature: 0.3, top_p: 0.9 });
  });

  it('does not affect other model entries', () => {
    const store: ModelSettingsStore = {
      'llama3.2:latest': { temperature: 0.8 },
      'qwen3:0.6b': { top_k: 30 },
    };
    const result = mergeSettings(store, 'llama3.2:latest', { temperature: 0.3 });
    expect(result['qwen3:0.6b']).toEqual({ top_k: 30 });
  });

  it('does not mutate the original store object', () => {
    const store: ModelSettingsStore = { 'llama3.2:latest': { temperature: 0.8 } };
    mergeSettings(store, 'llama3.2:latest', { temperature: 0.3 });
    expect(store['llama3.2:latest']!.temperature).toBe(0.8);
  });

  it('does not mutate the original model entry', () => {
    const entry = { temperature: 0.8 as number | undefined };
    const store: ModelSettingsStore = { 'llama3.2:latest': entry };
    mergeSettings(store, 'llama3.2:latest', { temperature: 0.3 });
    expect(entry.temperature).toBe(0.8);
  });

  it('adds a new model alongside existing ones', () => {
    const store: ModelSettingsStore = { 'llama3.2:latest': { temperature: 0.8 } };
    const result = mergeSettings(store, 'qwen3:0.6b', { top_k: 50 });
    expect(result['llama3.2:latest']).toEqual({ temperature: 0.8 });
    expect(result['qwen3:0.6b']).toEqual({ top_k: 50 });
  });
});

// ---------------------------------------------------------------------------
// MODEL_SETTINGS_VIEW_ID
// ---------------------------------------------------------------------------

describe('MODEL_SETTINGS_VIEW_ID', () => {
  it('is the expected view ID string', () => {
    expect(MODEL_SETTINGS_VIEW_ID).toBe('ollama-model-settings');
  });
});

// ---------------------------------------------------------------------------
// createModelSettingsViewProvider
// ---------------------------------------------------------------------------

describe('createModelSettingsViewProvider', () => {
  it('creates a ModelSettingsViewProvider instance', () => {
    const provider = createModelSettingsViewProvider({
      context: { extensionUri: {} } as never,
      initialStore: {},
      getAvailableModels: vi.fn().mockResolvedValue([]),
      onStoreChanged: vi.fn().mockResolvedValue(undefined),
    });
    expect(provider).toBeInstanceOf(ModelSettingsViewProvider);
  });
});

// ---------------------------------------------------------------------------
// ModelSettingsViewProvider — HTML content (via resolveWebviewView)
// ---------------------------------------------------------------------------

describe('buildHtml (via resolveWebviewView)', () => {
  afterEach(() => vi.clearAllMocks());

  it('sets HTML on the webview', async () => {
    const provider = makeProvider();
    const view = makeWebviewView();
    await provider.resolveWebviewView(view as never);
    expect(view.webview.html).toContain('Ollama Model Settings');
  });

  it('enables scripts on the webview', async () => {
    const provider = makeProvider();
    const view = makeWebviewView();
    await provider.resolveWebviewView(view as never);
    expect((view.webview.options as { enableScripts?: boolean }).enableScripts).toBe(true);
  });

  it('uses a nonced script tag', async () => {
    const provider = makeProvider();
    const view = makeWebviewView();
    await provider.resolveWebviewView(view as never);
    expect(view.webview.html).toMatch(/script nonce="[A-Za-z0-9]{32}"/);
  });

  it('includes Content-Security-Policy with script-src nonce', async () => {
    const provider = makeProvider();
    const view = makeWebviewView();
    await provider.resolveWebviewView(view as never);
    expect(view.webview.html).toContain("script-src 'nonce-");
  });

  it('includes the spinner element', async () => {
    const provider = makeProvider();
    const view = makeWebviewView();
    await provider.resolveWebviewView(view as never);
    expect(view.webview.html).toContain('id="spinner"');
  });

  it('includes think-row id for thinking checkbox section', async () => {
    const provider = makeProvider();
    const view = makeWebviewView();
    await provider.resolveWebviewView(view as never);
    expect(view.webview.html).toContain('id="think-row"');
  });

  it('includes think-budget-field id for thinking budget section', async () => {
    const provider = makeProvider();
    const view = makeWebviewView();
    await provider.resolveWebviewView(view as never);
    expect(view.webview.html).toContain('id="think-budget-field"');
  });

  it('includes title attributes on field labels', async () => {
    const provider = makeProvider();
    const view = makeWebviewView();
    await provider.resolveWebviewView(view as never);
    // All field labels should have title attributes
    expect(view.webview.html).toContain('title="Controls output randomness');
    expect(view.webview.html).toContain('title="Nucleus sampling cutoff');
    expect(view.webview.html).toContain('title="Limits token sampling');
    expect(view.webview.html).toContain('title="Maximum number of tokens held in the context window');
    expect(view.webview.html).toContain('title="Maximum number of tokens to generate per response');
    expect(view.webview.html).toContain('title="Enable chain-of-thought reasoning');
    expect(view.webview.html).toContain(
      'title="Maximum number of tokens the model may use for its internal thinking phase',
    );
  });

  it('includes disabled-section CSS class definition', async () => {
    const provider = makeProvider();
    const view = makeWebviewView();
    await provider.resolveWebviewView(view as never);
    expect(view.webview.html).toContain('.disabled-section');
  });

  it('includes client-side thinking model pattern check', async () => {
    const provider = makeProvider();
    const view = makeWebviewView();
    await provider.resolveWebviewView(view as never);
    expect(view.webview.html).toContain('THINKING_MODEL_PATTERN.test');
  });

  it('includes disabled-section toggle logic in renderFields', async () => {
    const provider = makeProvider();
    const view = makeWebviewView();
    await provider.resolveWebviewView(view as never);
    expect(view.webview.html).toContain("classList.toggle('disabled-section'");
  });

  it('includes input disabled logic for thinking inputs', async () => {
    const provider = makeProvider();
    const view = makeWebviewView();
    await provider.resolveWebviewView(view as never);
    expect(view.webview.html).toContain('thinkEl.disabled = !isThinking');
  });
});

// ---------------------------------------------------------------------------
// ModelSettingsViewProvider — message handling
// ---------------------------------------------------------------------------

describe('ModelSettingsViewProvider message handling', () => {
  afterEach(() => vi.clearAllMocks());

  it('posts hydrate message on ready', async () => {
    const provider = makeProvider();
    const view = makeWebviewView();
    await provider.resolveWebviewView(view as never);
    await view.fire({ type: 'ready' });
    expect(view.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'hydrate' }));
  });

  it('hydrate message includes sorted models from getAvailableModels + store keys', async () => {
    const getAvailableModels = vi.fn().mockResolvedValue(['llama3.2:latest']);
    const initialStore: ModelSettingsStore = { 'qwen3:0.6b': { temperature: 0.5 } };
    const provider = makeProvider({ getAvailableModels, initialStore });
    const view = makeWebviewView();
    await provider.resolveWebviewView(view as never);
    await view.fire({ type: 'ready' });

    const call = (view.webview.postMessage as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      models: string[];
      store: ModelSettingsStore;
    };
    expect(call.models).toContain('llama3.2:latest');
    expect(call.models).toContain('qwen3:0.6b');
    expect(call.store).toEqual(initialStore);
  });

  it('hydrate message has models sorted alphabetically', async () => {
    const getAvailableModels = vi.fn().mockResolvedValue(['zephyr:latest', 'llama3.2:latest', 'aya:8b']);
    const provider = makeProvider({ getAvailableModels });
    const view = makeWebviewView();
    await provider.resolveWebviewView(view as never);
    await view.fire({ type: 'ready' });

    const call = (view.webview.postMessage as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      models: string[];
    };
    expect(call.models).toEqual(['aya:8b', 'llama3.2:latest', 'zephyr:latest']);
  });

  it('hydrate selects first sorted model when no preferred model', async () => {
    const getAvailableModels = vi.fn().mockResolvedValue(['zephyr:latest', 'aya:8b']);
    const provider = makeProvider({ getAvailableModels });
    const view = makeWebviewView();
    await provider.resolveWebviewView(view as never);
    await view.fire({ type: 'ready' });

    const call = (view.webview.postMessage as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      selectedModel: string;
    };
    expect(call.selectedModel).toBe('aya:8b');
  });

  it('handles setModelSettings and calls onStoreChanged', async () => {
    const onStoreChanged = vi.fn().mockResolvedValue(undefined);
    const provider = makeProvider({ onStoreChanged });
    const view = makeWebviewView();
    await provider.resolveWebviewView(view as never);

    await view.fire({ type: 'setModelSettings', modelId: 'llama3.2:latest', patch: { temperature: 0.3 } });

    expect(onStoreChanged).toHaveBeenCalledWith(
      expect.objectContaining({ 'llama3.2:latest': expect.objectContaining({ temperature: 0.3 }) }),
    );
  });

  it('sanitizes invalid patch values in setModelSettings', async () => {
    const onStoreChanged = vi.fn().mockResolvedValue(undefined);
    const provider = makeProvider({ onStoreChanged });
    const view = makeWebviewView();
    await provider.resolveWebviewView(view as never);

    await view.fire({ type: 'setModelSettings', modelId: 'llama3.2:latest', patch: { temperature: 'invalid' } });

    // sanitizePatch strips all invalid values → empty patch → short-circuit, onStoreChanged NOT called
    expect(onStoreChanged).not.toHaveBeenCalled();
  });

  it('handles resetModelSettings and removes model from store', async () => {
    const onStoreChanged = vi.fn().mockResolvedValue(undefined);
    const initialStore: ModelSettingsStore = { 'llama3.2:latest': { temperature: 0.5 } };
    const provider = makeProvider({ onStoreChanged, initialStore });
    const view = makeWebviewView();
    await provider.resolveWebviewView(view as never);

    await view.fire({ type: 'resetModelSettings', modelId: 'llama3.2:latest' });

    expect(onStoreChanged).toHaveBeenCalledWith({});
  });

  it('resetModelSettings also pushes a fresh hydrate', async () => {
    const provider = makeProvider();
    const view = makeWebviewView();
    await provider.resolveWebviewView(view as never);

    await view.fire({ type: 'resetModelSettings', modelId: 'llama3.2:latest' });

    expect(view.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'hydrate' }));
  });

  it('ignores setModelSettings when modelId is missing', async () => {
    const onStoreChanged = vi.fn().mockResolvedValue(undefined);
    const provider = makeProvider({ onStoreChanged });
    const view = makeWebviewView();
    await provider.resolveWebviewView(view as never);

    await view.fire({ type: 'setModelSettings', patch: { temperature: 0.3 } });

    expect(onStoreChanged).not.toHaveBeenCalled();
  });

  it('ignores setModelSettings when modelId is empty string', async () => {
    const onStoreChanged = vi.fn().mockResolvedValue(undefined);
    const provider = makeProvider({ onStoreChanged });
    const view = makeWebviewView();
    await provider.resolveWebviewView(view as never);

    await view.fire({ type: 'setModelSettings', modelId: '', patch: { temperature: 0.3 } });

    expect(onStoreChanged).not.toHaveBeenCalled();
  });

  it('ignores unknown message types', async () => {
    const onStoreChanged = vi.fn().mockResolvedValue(undefined);
    const provider = makeProvider({ onStoreChanged });
    const view = makeWebviewView();
    await provider.resolveWebviewView(view as never);

    await view.fire({ type: 'unknownType' });

    expect(onStoreChanged).not.toHaveBeenCalled();
  });

  it('ignores null messages', async () => {
    const onStoreChanged = vi.fn().mockResolvedValue(undefined);
    const provider = makeProvider({ onStoreChanged });
    const view = makeWebviewView();
    await provider.resolveWebviewView(view as never);

    await view.fire(null);

    expect(onStoreChanged).not.toHaveBeenCalled();
  });

  it('does not push hydrate after webview is disposed', async () => {
    const provider = makeProvider();
    const view = makeWebviewView();
    await provider.resolveWebviewView(view as never);

    view.triggerDispose();
    await view.fire({ type: 'ready' });

    expect(view.webview.postMessage).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// ModelSettingsViewProvider — updateStore
// ---------------------------------------------------------------------------

describe('ModelSettingsViewProvider.updateStore', () => {
  afterEach(() => vi.clearAllMocks());

  it('pushes a hydrate message with the new store', async () => {
    const getAvailableModels = vi.fn().mockResolvedValue(['llama3.2:latest']);
    const provider = makeProvider({ getAvailableModels });
    const view = makeWebviewView();
    await provider.resolveWebviewView(view as never);

    const newStore: ModelSettingsStore = { 'llama3.2:latest': { temperature: 0.3 } };
    provider.updateStore(newStore);
    await flushMicrotasks();

    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'hydrate', store: newStore }),
    );
  });
});

// ---------------------------------------------------------------------------
// ModelSettingsViewProvider — open()
// ---------------------------------------------------------------------------

describe('ModelSettingsViewProvider.open', () => {
  afterEach(() => vi.clearAllMocks());

  it('calls executeCommand to reveal the explorer panel', async () => {
    const vscode = await import('vscode');
    const provider = makeProvider();
    await provider.open();
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('ollama-model-settings.focus');
  });

  it('shows the webview when it is already resolved', async () => {
    const provider = makeProvider();
    const view = makeWebviewView();
    await provider.resolveWebviewView(view as never);

    await provider.open();

    expect(view.show).toHaveBeenCalledWith(true);
  });

  it('sets the preferred model and uses it in the next hydrate', async () => {
    const getAvailableModels = vi.fn().mockResolvedValue(['llama3.2:latest', 'qwen3:0.6b']);
    const provider = makeProvider({ getAvailableModels });
    const view = makeWebviewView();
    await provider.resolveWebviewView(view as never);

    await provider.open('qwen3:0.6b');

    const allCalls = (view.webview.postMessage as ReturnType<typeof vi.fn>).mock.calls;
    const hydrateWithPreferred = allCalls.find(
      (c: unknown[]) => (c[0] as { selectedModel?: string }).selectedModel === 'qwen3:0.6b',
    );
    expect(hydrateWithPreferred).toBeTruthy();
  });
});
