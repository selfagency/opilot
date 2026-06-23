import type { Ollama } from 'ollama';
import * as vscode from 'vscode';
import type { DiagnosticsLogger } from './diagnostics.js';

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
      // webSearch exists on the Ollama SDK base class at runtime
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const result = await (
        this.client as unknown as { webSearch: (q: string, opts?: { max_results?: number }) => Promise<unknown> }
      ).webSearch(query, { max_results });

      const text = JSON.stringify(result, null, 2);
      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logChannel?.error(`[websearch] failed: ${message}`);
      throw new Error(`Web search failed: ${message}. The Ollama web search API requires an API key.`);
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
      // webFetch exists on the Ollama SDK base class at runtime
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const result = await (this.client as unknown as { webFetch: (url: string) => Promise<unknown> }).webFetch(url);

      const text = JSON.stringify(result, null, 2);
      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logChannel?.error(`[webfetch] failed: ${message}`);
      throw new Error(`Web fetch failed: ${message}. The Ollama web fetch API requires an API key.`);
    }
  }
}

export function registerOllamaWebTools(
  context: vscode.ExtensionContext,
  client: Ollama,
  logChannel?: DiagnosticsLogger
): void {
  context.subscriptions.push(
    vscode.lm.registerTool('ollama_webSearch', new OllamaWebSearchTool(client, logChannel)),
    vscode.lm.registerTool('ollama_webFetch', new OllamaWebFetchTool(client, logChannel))
  );
}
