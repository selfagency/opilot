import type { Ollama } from 'ollama';
import * as vscode from 'vscode';
import type { DiagnosticsLogger } from './diagnostics.js';

export const MAX_COMPLETION_PREFIX_CHARS = 2000;
export const MAX_COMPLETION_SUFFIX_CHARS = 500;

export class OllamaInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
  constructor(
    private readonly client: Ollama,
    private readonly logChannel?: DiagnosticsLogger,
  ) {}

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[] | null> {
    if (token.isCancellationRequested) return null;

    const config = vscode.workspace.getConfiguration('ollama');
    if (!config.get<boolean>('enableInlineCompletions', true)) return null;

    const modelId = config.get<string>('completionModel')?.trim() ?? '';
    if (!modelId) return null;

    const fullText = document.getText();
    const offset = document.offsetAt(position);
    const prefix = fullText.slice(0, offset).slice(-MAX_COMPLETION_PREFIX_CHARS);
    const rawSuffix = fullText.slice(offset);
    const suffix = rawSuffix.slice(0, MAX_COMPLETION_SUFFIX_CHARS);

    try {
      const response = await this.client.generate({
        model: modelId,
        prompt: prefix,
        suffix: suffix.length > 0 ? suffix : undefined,
        stream: false,
        options: { num_predict: 128, temperature: 0.1, stop: ['\n\n'] },
      });

      if (token.isCancellationRequested) return null;

      const text = response.response;
      if (!text?.trim()) return null;

      return [new vscode.InlineCompletionItem(text)];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logChannel?.error(`[Ollama] Inline completion failed: ${message}`);
      return null;
    }
  }
}
