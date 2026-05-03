/**
 * Phase 6: Chat Status Item — In-Chat Ollama Server Status
 *
 * Displays Ollama server status directly in the chat panel using the
 * proposed vscode.window.createChatStatusItem() API.
 * Status updates via the same health-check timer from statusBar.ts.
 */

import * as vscode from 'vscode';
import type { DiagnosticsLogger } from './diagnostics.js';
import type { LocalModelsProvider } from './sidebar.js';

export interface ChatStatusItemContext {
  modelProvider: LocalModelsProvider;
  diagnostics?: DiagnosticsLogger;
}

let chatStatusItem: vscode.ChatStatusItem | undefined;

/**
 * Create and register the chat status item.
 * Must be called during extension activation.
 */
export function createChatStatusItem(): vscode.ChatStatusItem | undefined {
  try {
    // Guard: only available on VS Code with proposed API
    if (typeof (vscode.window as any).createChatStatusItem !== 'function') {
      return undefined;
    }

    chatStatusItem = (vscode.window as any).createChatStatusItem?.('opilot.serverStatus');
    if (!chatStatusItem) {
      return undefined;
    }

    chatStatusItem!.title = 'Ollama';
    chatStatusItem!.description = 'Checking...';
    chatStatusItem!.isLoading = true;

    return chatStatusItem;
  } catch (err) {
    // Graceful degradation if API not available
    return undefined;
  }
}

/**
 * Update chat status item with server and model info.
 * Called from statusBar.ts health check timer.
 */
export function updateChatStatusItem(ctx: ChatStatusItemContext) {
  if (!chatStatusItem) return;

  try {
    const isOnline = (ctx.modelProvider as any).isServerOnline ?? false;
    const activeModel = (ctx.modelProvider as any).selectedModelId || 'None';
    const runningCount = (ctx.modelProvider as any).runningModelIds?.length || 0;

    if (isOnline) {
      chatStatusItem.description = `${activeModel} · ${runningCount} running`;
      chatStatusItem.isLoading = false;
      chatStatusItem.command = {
        title: 'Show Ollama',
        command: 'ollama.viewContainer:ollama',
      };
    } else {
      chatStatusItem.description = 'Offline';
      chatStatusItem.isLoading = false;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.diagnostics?.debug?.(`[chat-status] update failed: ${msg}`);
  }
}

/**
 * Dispose the chat status item.
 * Called during extension deactivation.
 */
export function disposeChatStatusItem() {
  chatStatusItem = undefined;
}
