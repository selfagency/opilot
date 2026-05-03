/**
 * Phase 7: Agent Mode — Inline File Editing
 *
 * Enables @ollama to edit files directly via stream.textEdit() and stream.workspaceEdit().
 * Gated behind opilot.agentMode setting (default false).
 *
 * Features:
 * - Detect agent mode requests via permissionLevel or explicit intent
 * - Parse model response for fenced code blocks
 * - Emit stream.textEdit() for file modifications
 * - Emit stream.workspaceEdit() for file creation/deletion
 * - Require confirmation before destructive edits
 */

import * as vscode from 'vscode';
import type { DiagnosticsLogger } from './diagnostics.js';

export interface AgentModeContext {
  permissionLevel?: 'autopilot' | 'autoApprove' | 'normal';
  diagnostics?: DiagnosticsLogger;
}

/**
 * Check if agent mode is enabled in settings.
 */
export function isAgentModeEnabled(): boolean {
  const config = vscode.workspace.getConfiguration('opilot');
  return config.get<boolean>('agentMode', false);
}

/**
 * Detect if request should be handled in agent mode.
 * Triggers on:
 * - request.permissionLevel === 'autopilot'
 * - #file or #selection references in request
 * - Explicit "edit this file" intent in prompt
 */
export function shouldUseAgentMode(ctx: AgentModeContext, prompt: string): boolean {
  if (!isAgentModeEnabled()) return false;
  if (ctx.permissionLevel === 'autopilot' || ctx.permissionLevel === 'autoApprove') return true;
  if (prompt.includes('#file') || prompt.includes('#selection')) return true;

  const agentKeywords = ['edit', 'refactor', 'fix', 'update', 'replace', 'modify', 'create file', 'new file'];
  return agentKeywords.some(kw => prompt.toLowerCase().includes(kw));
}

/**
 * Parse fenced code blocks from model response.
 * Returns array of { language, filename?, code }
 */
export interface CodeBlock {
  language: string;
  filename?: string;
  code: string;
}

export function parseCodeBlocks(content: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const regex = /```(\w+)?\s*(?:file=)?([^\n]*)?\n([\s\S]*?)```/g;

  let match;
  while ((match = regex.exec(content)) !== null) {
    const language = match[1] || 'text';
    const filename = match[2]?.trim();
    const code = match[3];

    blocks.push({ language, filename, code });
  }

  return blocks;
}

/**
 * Generate TextEdit array for file modifications.
 * Used by stream.textEdit(uri, edits).
 */
export function generateTextEdits(originalContent: string, newContent: string): vscode.TextEdit[] {
  // Replace entire document
  const lines = originalContent.split('\n');
  const range = new vscode.Range(
    new vscode.Position(0, 0),
    new vscode.Position(lines.length, lines[lines.length - 1]?.length || 0),
  );

  return [vscode.TextEdit.replace(range, newContent)];
}

/**
 * Request user confirmation before destructive edits.
 * Returns true if user accepts, false if rejects.
 */
export async function requestEditConfirmation(
  uri: vscode.Uri,
  preview: string,
  stream?: vscode.ChatResponseStream,
): Promise<boolean> {
  try {
    const message = `Apply changes to ${uri.fsPath}?\n\n${preview}`;
    const result = await vscode.window.showInformationMessage(message, { modal: true }, 'Apply', 'Cancel');

    if (stream && result === 'Apply') {
      try {
        stream.confirmation('File Updated', `Changes applied to ${uri.fsPath}`, {
          filePath: uri.fsPath,
        });
      } catch {
        // Confirmation API may not be available
      }
    }

    return result === 'Apply';
  } catch (err) {
    return false;
  }
}

/**
 * Apply text edits to a file via stream.textEdit().
 */
export async function applyTextEdits(
  stream: vscode.ChatResponseStream,
  uri: vscode.Uri,
  edits: vscode.TextEdit[],
): Promise<boolean> {
  try {
    // Phase 2 method: stream.textEdit(uri, edits)
    (stream as any).textEdit?.(uri, edits);

    // Signal completion
    (stream as any).textEdit?.(uri, true);

    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Create or delete files via stream.workspaceEdit().
 */
export async function applyWorkspaceEdit(
  stream: vscode.ChatResponseStream,
  edits: Array<{ newResource?: vscode.Uri; oldResource?: vscode.Uri }>,
): Promise<boolean> {
  try {
    // Phase 2 method: stream.workspaceEdit(edits)
    (stream as any).workspaceEdit?.(edits);
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * System prompt augmentation for agent mode.
 * Instructs model to emit code blocks with filename headers.
 */
export function getAgentModeSystemPrompt(): string {
  return `
You are a code editing assistant in agent mode. When editing or creating files:

1. Emit code in fenced blocks with language specification
2. Add filename as comment in first line: \`\`\`typescript file=src/utils.ts\`\`\`
3. Include full file content (don't assume existing code)
4. For file creation: use \`\`\`typescript file=new-file.ts\`\`\` syntax
5. For deletion: mention explicitly: "Delete: src/old-file.ts"

Keep responses concise; let the edits speak for themselves.
  `.trim();
}
