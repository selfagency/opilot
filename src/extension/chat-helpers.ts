/* eslint-disable @typescript-eslint/no-unused-vars */
import * as vscode from 'vscode';
import type { DiagnosticsLogger } from '../diagnostics.js';
import type { ResolvedReference } from '../prompts/OllamaPrompt.js';

// Expose the ResolvedReference type for external consumers to import if needed
export type _ResolvedReference = ResolvedReference;

// Derive a follow-up question suggestion from a prompt, to guide user interaction
export function deriveNextQuestion(prompt: string): string | undefined {
  const lower = prompt.toLowerCase();
  if (/\bapply|implement|creat|generat|write|fix|refactor|add|build\b/.test(lower)) {
    return 'Would you like to apply these changes?';
  }
  if (/\bmodel|pull|install|download|list models?\b/.test(lower)) {
    return 'Would you like to pull one of these models?';
  }
  return undefined;
}

/** Resolve prompts references (local files, locations, or direct strings) into plain text blocks.
 * Returns an array of label/content pairs that can be sent to the LLM as context.
 */
export async function resolvePromptReferences(
  references: ReadonlyArray<vscode.ChatPromptReference>,
  outputChannel?: DiagnosticsLogger,
): Promise<ReadonlyArray<{ label: string; content: string }>> {
  const resolved: Array<{ label: string; content: string }> = [];
  for (const ref of references) {
    try {
      const { value } = ref;
      if (value instanceof vscode.Uri) {
        const bytes = await vscode.workspace.fs.readFile(value);
        resolved.push({ label: value.fsPath, content: Buffer.from(bytes).toString('utf-8') });
      } else if (value instanceof vscode.Location) {
        const doc = await vscode.workspace.openTextDocument(value.uri);
        const text = doc.getText(value.range);
        const start = value.range.start.line + 1;
        const end = value.range.end.line + 1;
        resolved.push({ label: `${value.uri.fsPath}:${start}-${end}`, content: text });
      } else if (typeof value === 'string' && value.length > 0) {
        resolved.push({ label: ref.id, content: value });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      outputChannel?.debug?.(`[context] skipping unreadable prompt reference ${ref.id}: ${message}`);
    }
  }
  return resolved;
}
