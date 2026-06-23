import type { Ollama, WebFetchResponse, WebSearchResponse } from 'ollama';
import * as vscode from 'vscode';
import type { DiagnosticsLogger } from './diagnostics.js';
import { getSetting } from './settings.js';

function buildWebToolError(error: unknown, tool: string): Error {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  const isAuthError =
    normalized.includes('401') ||
    normalized.includes('403') ||
    normalized.includes('unauthorized') ||
    normalized.includes('forbidden') ||
    normalized.includes('api key');
  if (isAuthError) {
    return new Error(
      tool +
        ' failed: ' +
        message +
        ' The ' +
        tool +
        ' API requires an API key. Configure one via `ollama login` or the OLLAMA_API_KEY environment variable.'
    );
  }
  return new Error(`${tool} failed: ${message}`);
}

/**
 * Language model tool that calls Ollama's webSearch API.
 * Registered as `ollama_webSearch` for use in agent mode.
 */
export class OllamaWebSearchTool implements vscode.LanguageModelTool<{ query: string; max_results?: number }> {
  constructor(
    // biome-ignore lint/style/noParameterProperties: VS Code LanguageModelTool interface requires this pattern
    private readonly client: Ollama,
    // biome-ignore lint/style/noParameterProperties: VS Code LanguageModelTool interface requires this pattern
    private readonly logChannel?: DiagnosticsLogger
  ) {}

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<{ query: string; max_results?: number }>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { query, max_results } = options.input;
    if (!query?.trim()) {
      throw new Error('Search query is required.');
    }

    this.logChannel?.info(`[websearch] searching: ${query.slice(0, 100)}`);

    try {
      const result: WebSearchResponse = await this.client.webSearch(query, { max_results });
      const text = JSON.stringify(result, null, 2);
      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logChannel?.error(`[websearch] failed: ${message}`);
      throw buildWebToolError(error, 'web search');
    }
  }
}

/**
 * Language model tool that calls Ollama's webFetch API.
 * Registered as `ollama_webFetch` for use in agent mode.
 */
export class OllamaWebFetchTool implements vscode.LanguageModelTool<{ url: string }> {
  constructor(
    // biome-ignore lint/style/noParameterProperties: VS Code LanguageModelTool interface requires this pattern
    private readonly client: Ollama,
    // biome-ignore lint/style/noParameterProperties: VS Code LanguageModelTool interface requires this pattern
    private readonly logChannel?: DiagnosticsLogger
  ) {}

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<{ url: string }>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { url } = options.input;
    if (!url?.trim()) {
      throw new Error('URL is required.');
    }

    this.logChannel?.info(`[webfetch] fetching: ${url}`);

    try {
      const result: WebFetchResponse = await this.client.webFetch(url);
      const text = JSON.stringify(result, null, 2);
      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logChannel?.error(`[webfetch] failed: ${message}`);
      throw buildWebToolError(error, 'web fetch');
    }
  }
}

export function registerOllamaWebTools(
  context: vscode.ExtensionContext,
  client: Ollama,
  logChannel?: DiagnosticsLogger
): void {
  if (!getSetting<boolean>('experimental.webSearch', false)) {
    logChannel?.info('[websearch] web search tools disabled (opilot.experimental.webSearch is false)');
    return;
  }

  context.subscriptions.push(
    vscode.lm.registerTool('ollama_webSearch', new OllamaWebSearchTool(client, logChannel)),
    vscode.lm.registerTool('ollama_webFetch', new OllamaWebFetchTool(client, logChannel))
  );
}
