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

  const lowerPrompt = prompt.toLowerCase();
  const agentKeywords = ['edit', 'refactor', 'fix', 'update', 'replace', 'modify', 'create file', 'new file'];
  const hasEditIntent = agentKeywords.some(kw => lowerPrompt.includes(kw));
  const hasFileCue =
    lowerPrompt.includes(' file') ||
    lowerPrompt.includes('.ts') ||
    lowerPrompt.includes('.js') ||
    lowerPrompt.includes('.md') ||
    lowerPrompt.includes('path:');

  return hasEditIntent && hasFileCue;
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

const MAX_CODE_BLOCK_SIZE = 1_048_576; // 1 MB

function isWordOnly(input: string): boolean {
  if (input.length === 0) return false;
  for (const char of input) {
    const code = char.charCodeAt(0);
    const isNumber = code >= 48 && code <= 57;
    const isUpper = code >= 65 && code <= 90;
    const isLower = code >= 97 && code <= 122;
    const isUnderscore = code === 95;
    if (!isNumber && !isUpper && !isLower && !isUnderscore) {
      return false;
    }
  }
  return true;
}

function parseCodeBlockHeader(header: string): { language: string; filename?: string } {
  if (!header) {
    return { language: 'text' };
  }

  const trimmed = header.trim();
  const firstWhitespace = trimmed.search(/\s/);
  if (firstWhitespace === -1) {
    return isWordOnly(trimmed) ? { language: trimmed } : { language: 'text', filename: trimmed };
  }

  const language = trimmed.slice(0, firstWhitespace) || 'text';
  const rest = trimmed.slice(firstWhitespace).trim();
  if (!rest) {
    return { language };
  }

  if (rest.startsWith('file=')) {
    return { language, filename: rest.slice(5).trim() };
  }

  // allow header forms like "typescript src/foo.ts" or just a filename
  return { language, filename: rest };
}

function readCodeBlockFrame(
  content: string,
  cursor: number,
):
  | {
      nextCursor: number;
      block?: CodeBlock;
    }
  | undefined {
  const start = content.indexOf('```', cursor);
  if (start === -1) {
    return undefined;
  }

  const headerStart = start + 3;
  const newlineIndex = content.indexOf('\n', headerStart);
  if (newlineIndex === -1) {
    return { nextCursor: content.length };
  }

  const codeStart = newlineIndex + 1;
  const end = content.indexOf('```', codeStart);
  if (end === -1) {
    return { nextCursor: content.length };
  }

  const header = content.substring(headerStart, newlineIndex).trim();
  const code = content.substring(codeStart, end);
  const { language, filename } = parseCodeBlockHeader(header);

  if (code.length > MAX_CODE_BLOCK_SIZE) {
    console.warn(`[agent-mode] skipped oversized code block at offset ${start} (${code.length} bytes)`);
    return { nextCursor: end + 3 };
  }

  return { nextCursor: end + 3, block: { language, filename: filename?.trim(), code } };
}

export function parseCodeBlocks(content: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  let cursor = 0;
  while (true) {
    const frame = readCodeBlockFrame(content, cursor);
    if (!frame) {
      break;
    }
    if (frame.block) {
      blocks.push(frame.block);
    }
    cursor = frame.nextCursor;
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
  const lastLine = lines.at(-1) ?? '';
  const lastLineIndex = Math.max(lines.length - 1, 0);
  const range = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(lastLineIndex, lastLine.length));

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
        await stream.confirmation('File Updated', `Changes applied to ${uri.fsPath}`, {
          filePath: uri.fsPath,
        });
      } catch {
        // Confirmation API may not be available
      }
    }

    return result === 'Apply';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[agent-mode] confirmation prompt failed: ${message}`);
    return false;
  }
}

type ChatResponseEditStream = vscode.ChatResponseStream & {
  textEdit?: (uri: vscode.Uri, editsOrDone: vscode.TextEdit[] | boolean) => void;
  workspaceEdit?: (edits: Array<{ newResource?: vscode.Uri; oldResource?: vscode.Uri }>) => void;
};

/**
 * Apply text edits to a file via stream.textEdit().
 */
export async function applyTextEdits(
  stream: vscode.ChatResponseStream,
  uri: vscode.Uri,
  edits: vscode.TextEdit[],
): Promise<boolean> {
  try {
    const editStream = stream as ChatResponseEditStream;
    if (typeof editStream.textEdit !== 'function') {
      return false;
    }
    // Phase 2 method: stream.textEdit(uri, edits)
    editStream.textEdit(uri, edits);

    // Signal completion
    editStream.textEdit(uri, true);

    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[agent-mode] textEdit failed for ${uri.fsPath}: ${message}`);
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
    const editStream = stream as ChatResponseEditStream;
    if (typeof editStream.workspaceEdit !== 'function') {
      return false;
    }
    // Phase 2 method: stream.workspaceEdit(edits)
    editStream.workspaceEdit(edits);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[agent-mode] workspaceEdit failed: ${message}`);
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
