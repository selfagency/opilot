import type { Ollama } from 'ollama';
import * as vscode from 'vscode';
import type { DiagnosticsLogger } from './diagnostics.js';
import { getSetting } from './settings.js';

export const MAX_COMPLETION_PREFIX_CHARS = 2000;
export const MAX_COMPLETION_SUFFIX_CHARS = 500;

/**
 * Models that have rejected the suffix (FIM) parameter, cached to skip the
 * failing FIM attempt on subsequent calls.
 */
const nonFimModels = new Set<string>();

async function generateFallback(client: Ollama, modelId: string, prefix: string): Promise<string | null> {
  const fallback = await client.generate({
    model: modelId,
    prompt: prefix,
    stream: false,
    options: { num_predict: 128, temperature: 0.1, stop: ['\n\n'] }
  });
  const text = fallback.response;
  return text?.trim() ? text : null;
}

export class OllamaInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
  private readonly client: Ollama;
  private readonly logChannel?: DiagnosticsLogger;
  constructor(client: Ollama, logChannel?: DiagnosticsLogger) {
    this.client = client;
    this.logChannel = logChannel;
  }

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[] | null> {
    if (token.isCancellationRequested) {
      return null;
    }

    if (!getSetting<boolean>('enableInlineCompletions', true)) {
      return null;
    }

    const modelId = getSetting<string>('completionModel', '')?.trim() ?? '';
    if (!modelId) {
      return null;
    }

    const offset = document.offsetAt(position);
    const prefixStartOffset = Math.max(0, offset - MAX_COMPLETION_PREFIX_CHARS);
    const prefixStartPosition = document.positionAt(prefixStartOffset);
    const prefix = document.getText(new vscode.Range(prefixStartPosition, position));
    const documentLength = document.offsetAt(new vscode.Position(document.lineCount - 1, Number.MAX_SAFE_INTEGER));
    const suffixEndOffset = Math.min(documentLength, offset + MAX_COMPLETION_SUFFIX_CHARS);
    const suffixEndPosition = document.positionAt(suffixEndOffset);
    const suffix = document.getText(new vscode.Range(position, suffixEndPosition));

    // Skip suffix (FIM) for models known not to support it.
    const supportsFim = !nonFimModels.has(modelId);
    const effectiveSuffix = supportsFim && suffix.length > 0 ? suffix : undefined;

    try {
      const response = await this.client.generate({
        model: modelId,
        prompt: prefix,
        suffix: effectiveSuffix,
        stream: false,
        options: { num_predict: 128, temperature: 0.1, stop: ['\n\n'] }
      });

      if (token.isCancellationRequested) {
        return null;
      }

      const text = response.response;
      if (!text?.trim()) {
        return null;
      }

      return [new vscode.InlineCompletionItem(text)];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // model rejects FIM — retry once without suffix
      if (effectiveSuffix !== undefined && message.toLowerCase().includes('does not support insert')) {
        nonFimModels.add(modelId);
        this.logChannel?.warn(`[client] model ${modelId} does not support FIM; retrying without suffix`);
        const fallbackText = await generateFallback(this.client, modelId, prefix);
        if (!(fallbackText && !token.isCancellationRequested)) {
          return null;
        }
        return [new vscode.InlineCompletionItem(fallbackText)];
      }

      this.logChannel?.error(`[client] inline completion failed for ${modelId}: ${message}`);
      return null;
    }
  }
}
