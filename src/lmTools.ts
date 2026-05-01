import * as vscode from 'vscode';
import type { Ollama, ModelResponse } from 'ollama';
import type { DiagnosticsLogger } from './diagnostics.js';
import type { LocalModelsProvider } from './sidebar.js';
import { fetchModelCapabilities, testConnection } from './client.js';

// Wrap a JSON-serializable result into the VS Code LM return shape.
function wrapLmResult(payload: unknown): { content: vscode.LanguageModelTextPart[] } {
  return { content: [new vscode.LanguageModelTextPart(JSON.stringify(payload))] };
}

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

  try {
    /**
     * Tool: opilot_list_models
     * Lists all locally installed and cloud Ollama models with metadata.
     * Returns: { id: string, size: number, downloaded: boolean, running: boolean }[]
     * Auto-invoked during model discovery; can also be called manually for refresh.
     * Use case: Populate model pickers, check running models, verify available models.
     */
    const d1 = vscode.lm.registerTool(
      'opilot_list_models',
      {
        description: 'List all locally installed and cloud Ollama models',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      },
      async (_input: Record<string, unknown>, _token: vscode.CancellationToken) => {
        try {
          const list = await client.list();
          const ps = await client.ps();
          const runningNames = new Set(ps.models.map((m: ModelResponse) => m.name));
          const mapped = list.models.map((m: ModelResponse) => ({
            id: m.name,
            size: m.size,
            downloaded: true,
            running: runningNames.has(m.name),
          }));
          return wrapLmResult(mapped);
        } catch (error) {
          diagnostics?.exception?.('[lm-tools] opilot_list_models failed', error);
          return wrapLmResult({ error: error instanceof Error ? error.message : String(error) });
        }
      },
    );
    disposables.push(d1);

    /**
     * Tool: opilot_get_model_info
     * Returns detailed capabilities and metadata for a specific model.
     * Input: { modelId: string } (e.g., "llama3.2:3b")
     * Returns: { modelId: string, capabilities: CapabilityInfo }
     * Use case: Check if a model supports vision, tool-calling, thinking, or other features.
     */
    const d2 = vscode.lm.registerTool(
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
          if (!modelId) return wrapLmResult({ error: 'missing modelId' });
          const caps = await fetchModelCapabilities(client, modelId);
          return wrapLmResult({ modelId, capabilities: caps });
        } catch (error) {
          diagnostics?.exception?.('[lm-tools] opilot_get_model_info failed', error);
          return wrapLmResult({ error: error instanceof Error ? error.message : String(error) });
        }
      },
    );
    disposables.push(d2);

    /**
     * Tool: opilot_check_server_health
     * Checks connectivity to the configured Ollama server (local or remote).
     * Returns: { reachable: boolean, host: string | null, error?: string }
     * Timeout: 5 seconds
     * Use case: Verify server availability, diagnose connection issues, test auth.
     */
    const d3 = vscode.lm.registerTool(
      'opilot_check_server_health',
      {
        description: 'Check whether the configured Ollama server is reachable',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      },
      async (_input: Record<string, unknown>, _token: vscode.CancellationToken) => {
        try {
          const ok = await testConnection(client, 5000);
          const host = (client as unknown as { config: { host: string } }).config?.host ?? null;
          return wrapLmResult({ reachable: !!ok, host });
        } catch (error) {
          diagnostics?.exception?.('[lm-tools] opilot_check_server_health failed', error);
          return wrapLmResult({ reachable: false, error: error instanceof Error ? error.message : String(error) });
        }
      },
    );
    disposables.push(d3);

    /**
     * Tool: opilot_pull_model
     * Downloads a model from the Ollama library to the local machine.
     * Input: { modelId: string } (e.g., "llama3.2:3b")
     * Returns: { pulled: true, modelId: string } on success, or { error: string } on failure
     * Note: Downloads synchronously to simplify tool semantics; can be long-running.
     * Use case: Programmatic model acquisition for agentic workflows.
     */
    const d4 = vscode.lm.registerTool(
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
          if (!modelId) return wrapLmResult({ error: 'missing modelId' });
          await client.pull({ model: modelId, stream: false });
          try {
            localProvider.refresh();
          } catch {
            // best-effort
          }
          return wrapLmResult({ pulled: true, modelId });
        } catch (error) {
          diagnostics?.exception?.('[lm-tools] opilot_pull_model failed', error);
          return wrapLmResult({ error: error instanceof Error ? error.message : String(error) });
        }
      },
    );
    disposables.push(d4);

    /**
     * Tool: opilot_start_model
     * Warms up (loads into memory) a model so it responds without cold-start delay.
     * Input: { modelId: string } (e.g., "llama3.2:3b")
     * Returns: { started: true, modelId: string } on success, or { error: string } on failure
     * Idempotent: Safe to call on an already-running model.
     * Use case: Prepare model for agentic task, reduce response latency.
     */
    const d5 = vscode.lm.registerTool(
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
          if (!modelId) return wrapLmResult({ error: 'missing modelId' });
          // Use the LocalModelsProvider API directly (safe and idempotent)
          await localProvider.startModel(modelId);
          return wrapLmResult({ started: true, modelId });
        } catch (error) {
          diagnostics?.exception?.('[lm-tools] opilot_start_model failed', error);
          return wrapLmResult({ error: error instanceof Error ? error.message : String(error) });
        }
      },
    );
    disposables.push(d5);

    /**
     * Tool: opilot_stop_model
     * Unloads a running model from memory to free VRAM/RAM.
     * Input: { modelId: string } (e.g., "llama3.2:3b")
     * Returns: { stopped: true, modelId: string } on success, or { error: string } on failure
     * Safe to call on a stopped or non-existent model (no-op).
     * Use case: Free resources between tasks, prevent VRAM exhaustion with large models.
     */
    const d6 = vscode.lm.registerTool(
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
          if (!modelId) return wrapLmResult({ error: 'missing modelId' });
          await localProvider.stopModel(modelId);
          return wrapLmResult({ stopped: true, modelId });
        } catch (error) {
          diagnostics?.exception?.('[lm-tools] opilot_stop_model failed', error);
          return wrapLmResult({ error: error instanceof Error ? error.message : String(error) });
        }
      },
    );
    disposables.push(d6);
  } catch (err) {
    diagnostics?.exception?.('[lm-tools] failed to register tools', err);
  }

  for (const d of disposables) context.subscriptions.push(d);
  return disposables;
}
