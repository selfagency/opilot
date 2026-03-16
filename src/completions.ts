import type { Ollama } from 'ollama';
import * as vscode from 'vscode';
import type { DiagnosticsLogger } from './diagnostics.js';
import { getSetting } from './settings.js';

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

    if (!getSetting<boolean>('enableInlineCompletions', true)) return null;

    const modelId = getSetting<string>('completionModel', '')?.trim() ?? '';
    if (!modelId) return null;

    const offset = document.offsetAt(position);
    // Compute prefix window using a range instead of materializing the entire document.
    const prefixStartOffset = Math.max(0, offset - MAX_COMPLETION_PREFIX_CHARS);
    const prefixStartPosition = document.positionAt(prefixStartOffset);
    const prefix = document.getText(new vscode.Range(prefixStartPosition, position));
    // Compute suffix window using a range limited by MAX_COMPLETION_SUFFIX_CHARS.
    const documentLength = document.offsetAt(new vscode.Position(document.lineCount - 1, Number.MAX_SAFE_INTEGER));
    const suffixEndOffset = Math.min(documentLength, offset + MAX_COMPLETION_SUFFIX_CHARS);
    const suffixEndPosition = document.positionAt(suffixEndOffset);
    const suffix = document.getText(new vscode.Range(position, suffixEndPosition));

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
      this.logChannel?.error(`[client] inline completion failed: ${message}`);
      return null;
    }
  }
}
