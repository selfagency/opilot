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

type ChatStatusItemFactoryApi = {
  createChatStatusItem?: (id: string) => vscode.ChatStatusItem | undefined;
};

type ModelProviderStatusLike = {
  isServerOnline?: boolean;
  selectedModelId?: string;
  runningModelIds?: string[];
};

/**
 * Create and register the chat status item.
 * Must be called during extension activation.
 */
export function createChatStatusItem(): vscode.ChatStatusItem | undefined {
  try {
    const windowApi = vscode.window as unknown as ChatStatusItemFactoryApi;
    // Guard: only available on VS Code with proposed API
    if (typeof windowApi.createChatStatusItem !== 'function') {
      return undefined;
    }

    chatStatusItem = windowApi.createChatStatusItem?.('opilot.serverStatus');
    if (!chatStatusItem) {
      return undefined;
    }

    chatStatusItem.title = 'Ollama';
    chatStatusItem.description = 'Checking...';
    chatStatusItem.isLoading = true;

    return chatStatusItem;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[chat-status] createChatStatusItem failed: ${message}`);
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
    const providerStatus = ctx.modelProvider as unknown as ModelProviderStatusLike;
    const isOnline = providerStatus.isServerOnline ?? false;
    const activeModel = providerStatus.selectedModelId || 'None';
    const runningCount = providerStatus.runningModelIds?.length || 0;

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
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
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
