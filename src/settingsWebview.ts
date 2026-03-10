import * as vscode from 'vscode';
import type { DiagnosticsLogger } from './diagnostics.js';
import type { ModelOptionOverrides, ModelSettingsStore } from './modelSettings.js';

const MODEL_SETTINGS_VIEW_ID = 'ollama-model-settings';
export const THINKING_MODEL_PATTERN = /qwen3|qwq|deepseek-?r1|cogito|phi\d+-reasoning|kimi|thinking/i;

export interface ModelSettingsViewProviderOptions {
  context: vscode.ExtensionContext;
  initialStore: ModelSettingsStore;
  getAvailableModels: () => Promise<string[]>;
  onStoreChanged: (nextStore: ModelSettingsStore) => Promise<void>;
  diagnostics?: Pick<DiagnosticsLogger, 'warn' | 'exception'>;
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function sanitizePatch(value: unknown): Partial<ModelOptionOverrides> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const candidate = value as Record<string, unknown>;
  const patch: Partial<ModelOptionOverrides> = {};

  if (isFiniteNumber(candidate.temperature)) patch.temperature = candidate.temperature;
  if (isFiniteNumber(candidate.top_p)) patch.top_p = candidate.top_p;
  if (isFiniteNumber(candidate.top_k)) patch.top_k = candidate.top_k;
  if (isFiniteNumber(candidate.num_ctx)) patch.num_ctx = candidate.num_ctx;
  if (isFiniteNumber(candidate.num_predict)) patch.num_predict = candidate.num_predict;
  if (typeof candidate.think === 'boolean') patch.think = candidate.think;
  if (isFiniteNumber(candidate.think_budget)) patch.think_budget = candidate.think_budget;

  return patch;
}

export function mergeSettings(
  current: ModelSettingsStore,
  modelId: string,
  patch: Partial<ModelOptionOverrides>,
): ModelSettingsStore {
  const next = { ...current };
  next[modelId] = {
    ...next[modelId],
    ...patch,
  };
  return next;
}

function buildHtml(webview: vscode.Webview, _extensionUri: vscode.Uri): string {
  const nonce = getNonce();

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Ollama Model Settings</title>
    <style>
      :root { color-scheme: light dark; }
      * { box-sizing: border-box; }
      body {
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
        color: var(--vscode-foreground);
        background: var(--vscode-sideBar-background);
        padding: 0;
        margin: 0;
      }
      .header {
        padding: 8px 12px;
        display: grid;
        gap: 6px;
        border-bottom: 1px solid var(--vscode-panel-border);
      }
      .model-row {
        display: grid;
        grid-template-columns: 45px 1fr auto;
        gap: 6px;
        align-items: center;
      }
      label {
        font-size: 11px;
        opacity: 0.7;
      }
      select, input[type="number"] {
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        border: 1px solid var(--vscode-input-border);
        padding: 3px 6px;
        border-radius: 2px;
        font-family: var(--vscode-font-family);
        font-size: 11px;
      }
      select:focus, input:focus {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: -1px;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
      .spinner {
        width: 14px;
        height: 14px;
        border: 2px solid var(--vscode-panel-border);
        border-top-color: var(--vscode-foreground);
        border-radius: 50%;
        animation: spin 0.7s linear infinite;
        display: none;
      }
      .content {
        padding: 12px;
        display: grid;
        gap: 12px;
      }
      .field {
        display: grid;
        gap: 4px;
      }
      .field-label {
        font-size: 11px;
        opacity: 0.9;
      }
      .row {
        display: grid;
        grid-template-columns: 1fr 70px;
        gap: 8px;
        align-items: center;
      }
      input[type="range"] {
        width: 100%;
        height: 4px;
        border-radius: 2px;
        outline: none;
        -webkit-appearance: none;
        background: var(--vscode-input-background);
      }
      input[type="range"]::-webkit-slider-track {
        width: 100%;
        height: 4px;
        background: var(--vscode-input-background);
        border-radius: 2px;
      }
      input[type="range"]::-moz-range-track {
        width: 100%;
        height: 4px;
        background: var(--vscode-input-background);
        border-radius: 2px;
      }
      input[type="range"]::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: var(--vscode-inputOption-activeForeground);
        border: 1px solid var(--vscode-inputOption-activeBorder);
        cursor: pointer;
      }
      input[type="range"]::-moz-range-thumb {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: var(--vscode-inputOption-activeForeground);
        border: 1px solid var(--vscode-inputOption-activeBorder);
        cursor: pointer;
      }
      input[type="number"] {
        text-align: center;
        padding: 2px 4px;
      }
      .checkbox-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 4px 0;
      }
      input[type="checkbox"] {
        -webkit-appearance: none;
        -moz-appearance: none;
        appearance: none;
        width: 16px;
        height: 16px;
        cursor: pointer;
        border: 1px solid var(--vscode-input-border);
        background: var(--vscode-input-background);
        border-radius: 2px;
      }
      input[type="checkbox"]:checked {
        background: var(--vscode-button-background);
        border-color: var(--vscode-button-background);
      }
      input[type="checkbox"]:checked::after {
        content: '✓';
        display: block;
        text-align: center;
        color: var(--vscode-button-foreground);
        font-size: 12px;
        line-height: 16px;
      }
      button {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none;
        padding: 4px 10px;
        border-radius: 4px;
        cursor: pointer;
        font-family: var(--vscode-font-family);
        font-size: 11px;
      }
      button:hover {
        background: var(--vscode-button-hoverBackground);
      }
      button:active {
        opacity: 0.9;
      }
      .actions {
        margin-top: 4px;
      }
      .disabled-section {
        opacity: 0.4;
        pointer-events: none;
      }
    </style>
  </head>
  <body>
    <div class="header">
      <div class="model-row">
          <label for="model">Model</label>
          <select id="model"></select>
          <span id="spinner" class="spinner" aria-hidden="true"></span>
        </div>
      </div>

      <div class="content">
        <div class="field">
          <div class="field-label" title="Controls output randomness. Lower values are more deterministic; higher values are more creative.">Temperature</div>
          <div class="row">
            <input type="range" id="temperature" min="0" max="2" step="0.01" aria-label="Temperature (slider)" />
            <input type="number" id="temperatureNumber" min="0" max="2" step="0.01" aria-label="Temperature (value)" />
          </div>
        </div>

        <div class="field">
          <div class="field-label" title="Nucleus sampling cutoff. Restricts token sampling to the most likely tokens whose cumulative probability reaches this value.">Top-P</div>
          <div class="row">
            <input type="range" id="top_p" min="0" max="1" step="0.01" aria-label="Top-P (slider)" />
            <input type="number" id="top_pNumber" min="0" max="1" step="0.01" aria-label="Top-P (value)" />
          </div>
        </div>

        <div class="field">
          <div class="field-label" title="Limits token sampling to the K most likely next tokens. Lower values make output more focused.">Top-K</div>
          <div class="row">
            <input type="range" id="top_k" min="0" max="100" step="1" aria-label="Top-K (slider)" />
            <input type="number" id="top_kNumber" min="0" max="100" step="1" aria-label="Top-K (value)" />
          </div>
        </div>

        <div class="field">
          <div class="field-label" title="Maximum number of tokens held in the context window (prompt + response). Larger values allow longer conversations.">Context Window</div>
          <div class="row">
            <input type="range" id="num_ctx" min="512" max="131072" step="512" aria-label="Context Window (slider)" />
            <input type="number" id="num_ctxNumber" min="512" max="131072" step="512" aria-label="Context Window (value)" />
          </div>
        </div>

        <div class="checkbox-row">
          <span class="field-label" title="Maximum number of tokens to generate per response. Use -1 for unlimited.">Max Tokens (-1 = unlimited)</span>
          <input type="number" id="num_predict" step="1" style="width:70px" aria-label="Max Tokens" />
        </div>

        <div class="checkbox-row" id="think-row">
          <span class="field-label" title="Enable chain-of-thought reasoning before answering. Only available for thinking models.">Thinking</span>
          <input type="checkbox" id="think" aria-label="Enable Thinking" />
        </div>

        <div class="field" id="think-budget-field">
          <div class="field-label" title="Maximum number of tokens the model may use for its internal thinking phase.">Thinking Budget</div>
          <div class="row">
            <input type="range" id="think_budget" min="0" max="16384" step="1" aria-label="Thinking Budget (slider)" />
            <input type="number" id="think_budgetNumber" min="0" max="16384" step="1" aria-label="Thinking Budget (value)" />
          </div>
        </div>

        <div class="actions">
          <button id="reset">↻ Reset</button>
        </div>
      </div>

    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const THINKING_MODEL_PATTERN = ${THINKING_MODEL_PATTERN};
      const defaults = {
        temperature: 0.8,
        top_p: 0.9,
        top_k: 40,
        num_ctx: 2048,
        num_predict: -1,
        think: false,
        think_budget: 2048,
      };

      let store = {};
      let models = [];
      let selectedModel = '';

      let modelEl;
      let spinnerEl;
      let spinnerTimeout;

      function init() {
        modelEl = document.getElementById('model');
        spinnerEl = document.getElementById('spinner');

        if (!modelEl) {
          console.error('Failed to find required elements');
          return;
        }

        modelEl.addEventListener('change', () => {
          selectedModel = modelEl.value;
          renderFields();
        });

        document.getElementById('num_predict').addEventListener('change', event => {
          emitPatch({ num_predict: Number(event.target.value) });
        });

        document.getElementById('think').addEventListener('change', event => {
          emitPatch({ think: Boolean(event.target.checked) });
        });

        document.getElementById('reset').addEventListener('click', () => {
          if (!selectedModel) return;
          vscode.postMessage({ type: 'resetModelSettings', modelId: selectedModel });
          delete store[selectedModel];
          renderFields();
          flashSpinner();
        });

        bindPair('temperature');
        bindPair('top_p');
        bindPair('top_k', v => Number.parseInt(v, 10));
        bindPair('num_ctx', v => Number.parseInt(v, 10));
        bindPair('think_budget', v => Number.parseInt(v, 10));

        // Must set up message listener BEFORE sending ready message
        window.addEventListener('message', event => {
          const message = event.data || {};
          if (message.type === 'hydrate') {
            store = message.store || {};
            models = message.models || [];
            if (typeof message.selectedModel === 'string') {
              selectedModel = message.selectedModel;
            }
            renderModelOptions();
          }
        });

        // Now tell backend we're ready
        vscode.postMessage({ type: 'ready' });
      }

      function syncPair(baseId, value) {
        const range = document.getElementById(baseId);
        const number = document.getElementById(baseId + 'Number');
        if (range) range.value = String(value);
        if (number) number.value = String(value);
      }

      function valuesForModel(modelId) {
        const isThinking = THINKING_MODEL_PATTERN.test(modelId);
        const thinkDefault = isThinking ? { think: true } : {};
        return { ...defaults, ...thinkDefault, ...(store[modelId] || {}) };
      }

      function renderModelOptions() {
        const prev = selectedModel;
        modelEl.innerHTML = '';
        for (const model of models) {
          const option = document.createElement('option');
          option.value = model;
          option.textContent = model;
          modelEl.appendChild(option);
        }

        if (!selectedModel || !models.includes(selectedModel)) {
          selectedModel = prev && models.includes(prev) ? prev : (models[0] || '');
        }

        if (selectedModel) {
          modelEl.value = selectedModel;
        }

        renderFields();
      }

      function renderFields() {
        const modelId = selectedModel;
        if (!modelId) {
          return;
        }

        const isThinking = THINKING_MODEL_PATTERN.test(modelId);
        const values = valuesForModel(modelId);
        syncPair('temperature', values.temperature);
        syncPair('top_p', values.top_p);
        syncPair('top_k', values.top_k);
        syncPair('num_ctx', values.num_ctx);
        document.getElementById('num_predict').value = String(values.num_predict);
        const thinkEl = document.getElementById('think');
        thinkEl.checked = Boolean(values.think);
        thinkEl.disabled = !isThinking;
        document.getElementById('think_budget').disabled = !isThinking;
        document.getElementById('think_budgetNumber').disabled = !isThinking;
        syncPair('think_budget', values.think_budget);
        document.getElementById('think-row').classList.toggle('disabled-section', !isThinking);
        document.getElementById('think-budget-field').classList.toggle('disabled-section', !isThinking);
      }

      const KNOWN_KEYS = new Set(['temperature', 'top_p', 'top_k', 'num_ctx', 'num_predict', 'think', 'think_budget']);

      function emitPatch(patch) {
        if (!selectedModel) return;
        // Validate client-side: only known keys, reject non-finite numbers and NaN before mutating store
        const validated = {};
        for (const [key, value] of Object.entries(patch)) {
          if (!KNOWN_KEYS.has(key)) continue;
          if (typeof value === 'boolean') {
            validated[key] = value;
          } else if (typeof value === 'number' && Number.isFinite(value)) {
            validated[key] = value;
          }
        }
        if (Object.keys(validated).length === 0) return;
        vscode.postMessage({ type: 'setModelSettings', modelId: selectedModel, patch: validated });
        store[selectedModel] = { ...(store[selectedModel] || {}), ...validated };
        flashSpinner();
      }

      function flashSpinner() {
        if (!spinnerEl) return;
        spinnerEl.style.display = 'inline-block';
        clearTimeout(spinnerTimeout);
        spinnerTimeout = setTimeout(() => { spinnerEl.style.display = 'none'; }, 800);
      }

      function bindPair(baseId, parseFn = Number) {
        const range = document.getElementById(baseId);
        const number = document.getElementById(baseId + 'Number');

        if (range) {
          range.addEventListener('input', () => {
            if (number) number.value = range.value;
            emitPatch({ [baseId]: parseFn(range.value) });
          });
        }

        if (number) {
          number.addEventListener('change', () => {
            if (range) range.value = number.value;
            emitPatch({ [baseId]: parseFn(number.value) });
          });
        }
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
      } else {
        init();
      }
    </script>
  </body>
</html>`;
}

export class ModelSettingsViewProvider implements vscode.WebviewViewProvider {
  private webviewView: vscode.WebviewView | undefined;
  private store: ModelSettingsStore;
  private preferredModel: string | undefined;

  constructor(private readonly options: ModelSettingsViewProviderOptions) {
    this.store = { ...options.initialStore };
  }

  async open(modelId?: string): Promise<void> {
    if (modelId) {
      this.preferredModel = modelId;
    }

    // Focus the view directly — this reveals the sidebar container and the panel
    // even on first use before resolveWebviewView has been called.
    await vscode.commands.executeCommand(`${MODEL_SETTINGS_VIEW_ID}.focus`);

    if (this.webviewView) {
      this.webviewView.show?.(true);
      await this.pushHydrateMessage();
    }
  }

  async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    this.webviewView = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.options.context.extensionUri],
    };

    webviewView.webview.html = buildHtml(webviewView.webview, this.options.context.extensionUri);

    webviewView.webview.onDidReceiveMessage(async message => {
      try {
        if (!message || typeof message !== 'object') {
          return;
        }

        const payload = message as { type?: unknown; modelId?: unknown; patch?: unknown };

        if (payload.type === 'ready') {
          await this.pushHydrateMessage();
          return;
        }

        if (typeof payload.modelId !== 'string' || payload.modelId.length === 0) {
          return;
        }

        if (payload.type === 'setModelSettings') {
          const patch = sanitizePatch(payload.patch);
          if (Object.keys(patch).length === 0) {
            return;
          }
          this.store = mergeSettings(this.store, payload.modelId, patch);
          await this.options.onStoreChanged(this.store);
          return;
        }

        if (payload.type === 'resetModelSettings') {
          const next = { ...this.store };
          delete next[payload.modelId];
          this.store = next;
          await this.options.onStoreChanged(this.store);
          await this.pushHydrateMessage();
        }
      } catch (error) {
        this.options.diagnostics?.exception('[model-settings] failed handling view message', error);
      }
    });

    webviewView.onDidDispose(() => {
      this.webviewView = undefined;
    });
  }

  updateStore(nextStore: ModelSettingsStore): void {
    this.store = { ...nextStore };
    void this.pushHydrateMessage();
  }

  private async pushHydrateMessage(): Promise<void> {
    if (!this.webviewView) {
      return;
    }

    const availableModels = await this.options.getAvailableModels();
    const sorted = [
      ...new Set([
        ...availableModels,
        ...Object.keys(this.store),
        ...(this.preferredModel ? [this.preferredModel] : []),
      ]),
    ].sort((a, b) => a.localeCompare(b));

    let selectedModel = this.preferredModel;
    if (!selectedModel || !sorted.includes(selectedModel)) {
      selectedModel = sorted[0];
    }

    await this.webviewView.webview.postMessage({
      type: 'hydrate',
      models: sorted,
      store: this.store,
      selectedModel,
    });
  }
}

export function createModelSettingsViewProvider(options: ModelSettingsViewProviderOptions): ModelSettingsViewProvider {
  return new ModelSettingsViewProvider(options);
}

export { MODEL_SETTINGS_VIEW_ID };
