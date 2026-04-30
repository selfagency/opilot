import * as vscode from 'vscode';
import type { Ollama } from 'ollama';
import type { DiagnosticsLogger } from './diagnostics.js';
import type { LocalModelsProvider } from './sidebar.js';
import { fetchModelCapabilities, testConnection } from './client.js';

/**
 * Register a small set of Opilot language-model tools exposing read and
 * safe lifecycle operations for Ollama models. These tools are intentionally
 * conservative: heavy side-effects (delete) are omitted; start/stop/pull are
 * provided because they are explicit user-initiated lifecycle operations.
 */
export function registerOpilotLmTools(
  context: vscode.ExtensionContext,
  client: Ollama,
  localProvider: LocalModelsProvider,
  diagnostics?: DiagnosticsLogger,
): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = [];

  // Helper to wrap a JSON-serializable result into the VS Code LM return shape.
  const wrapResult = (payload: unknown) => {
    // The LanguageModel tool result convention in tests uses an object with `content`
    // array of LanguageModelTextPart. In the real API the LM host will accept
    // structured results; emitting a single text part with JSON is interoperable.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { content: [new (vscode as any).LanguageModelTextPart(JSON.stringify(payload))] };
  };

  try {
    // List models
    const d1 = (vscode as any).lm.registerTool(
      'opilot_list_models',
      {
        description: 'List all locally installed and cloud Ollama models',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      },
      async (_input: Record<string, unknown>, _token: vscode.CancellationToken) => {
        try {
          const list = await client.list();
          const ps = await client.ps();
          const runningNames = new Set(ps.models.map((m: any) => m.name));
          const mapped = list.models.map((m: any) => ({
            id: m.name,
            size: m.size,
            downloaded: true,
            running: runningNames.has(m.name),
          }));
          return wrapResult(mapped);
        } catch (error) {
          diagnostics?.exception?.('[lm-tools] opilot_list_models failed', error);
          return wrapResult({ error: (error instanceof Error ? error.message : String(error)) });
        }
      },
    );
    disposables.push(d1);

    // Get model info
    const d2 = (vscode as any).lm.registerTool(
      'opilot_get_model_info',
      {
        description: 'Return capabilities and metadata for a specific Ollama model',
        inputSchema: {
          type: 'object',
          properties: { modelId: { type: 'string' } },
          required: ['modelId'],
          additionalProperties: false,
        },
      },
      async (input: Record<string, unknown>, _token: vscode.CancellationToken) => {
        try {
          const modelId = typeof input.modelId === 'string' ? input.modelId : '';
          if (!modelId) return wrapResult({ error: 'missing modelId' });
          const caps = await fetchModelCapabilities(client, modelId);
          return wrapResult({ modelId, capabilities: caps });
        } catch (error) {
          diagnostics?.exception?.('[lm-tools] opilot_get_model_info failed', error);
          return wrapResult({ error: (error instanceof Error ? error.message : String(error)) });
        }
      },
    );
    disposables.push(d2);

    // Check server health
    const d3 = (vscode as any).lm.registerTool(
      'opilot_check_server_health',
      {
        description: 'Check whether the configured Ollama server is reachable',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      },
      async (_input: Record<string, unknown>, _token: vscode.CancellationToken) => {
        try {
          const ok = await testConnection(client, 5000);
          return wrapResult({ reachable: !!ok, host: (client as any).host ?? null });
        } catch (error) {
          diagnostics?.exception?.('[lm-tools] opilot_check_server_health failed', error);
          return wrapResult({ reachable: false, error: (error instanceof Error ? error.message : String(error)) });
        }
      },
    );
    disposables.push(d3);

    // Pull model (long running) — perform a direct pull without interactive UI.
    // Note: this downloads synchronously (stream: false) to simplify tool semantics.
    const d4 = (vscode as any).lm.registerTool(
      'opilot_pull_model',
      {
        description: 'Pull (download) a model from the Ollama library to the local machine',
        inputSchema: {
          type: 'object',
          properties: { modelId: { type: 'string' } },
          required: ['modelId'],
          additionalProperties: false,
        },
      },
      async (input: Record<string, unknown>, _token: vscode.CancellationToken) => {
        try {
          const modelId = typeof input.modelId === 'string' ? input.modelId : '';
          if (!modelId) return wrapResult({ error: 'missing modelId' });
          await client.pull({ model: modelId, stream: false });
          try {
            localProvider.refresh();
          } catch {
            // best-effort
          }
          return wrapResult({ pulled: true, modelId });
        } catch (error) {
          diagnostics?.exception?.('[lm-tools] opilot_pull_model failed', error);
          return wrapResult({ error: (error instanceof Error ? error.message : String(error)) });
        }
      },
    );
    disposables.push(d4);

    // Start model (warm)
    const d5 = (vscode as any).lm.registerTool(
      'opilot_start_model',
      {
        description: 'Start (warm) a locally-installed or cloud model',
        inputSchema: {
          type: 'object',
          properties: { modelId: { type: 'string' } },
          required: ['modelId'],
          additionalProperties: false,
        },
      },
      async (input: Record<string, unknown>, _token: vscode.CancellationToken) => {
        try {
          const modelId = typeof input.modelId === 'string' ? input.modelId : '';
          if (!modelId) return wrapResult({ error: 'missing modelId' });
          // Use the LocalModelsProvider API directly (safe and idempotent)
          await localProvider.startModel(modelId);
          return wrapResult({ started: true, modelId });
        } catch (error) {
          diagnostics?.exception?.('[lm-tools] opilot_start_model failed', error);
          return wrapResult({ error: (error instanceof Error ? error.message : String(error)) });
        }
      },
    );
    disposables.push(d5);

    // Stop model
    const d6 = (vscode as any).lm.registerTool(
      'opilot_stop_model',
      {
        description: 'Stop (unload) a running model',
        inputSchema: {
          type: 'object',
          properties: { modelId: { type: 'string' } },
          required: ['modelId'],
          additionalProperties: false,
        },
      },
      async (input: Record<string, unknown>, _token: vscode.CancellationToken) => {
        try {
          const modelId = typeof input.modelId === 'string' ? input.modelId : '';
          if (!modelId) return wrapResult({ error: 'missing modelId' });
          await localProvider.stopModel(modelId);
          return wrapResult({ stopped: true, modelId });
        } catch (error) {
          diagnostics?.exception?.('[lm-tools] opilot_stop_model failed', error);
          return wrapResult({ error: (error instanceof Error ? error.message : String(error)) });
        }
      },
    );
    disposables.push(d6);
  } catch (err) {
    diagnostics?.exception?.('[lm-tools] failed to register tools', err);
  }

  disposables.forEach(d => context.subscriptions.push(d));
  return disposables;
}
