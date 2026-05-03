/**
 * Phase 9: Chat Session Customization Provider
 *
 * Surfaces Modelfiles in VS Code's built-in customization management UI.
 * Scans modelfiles folder and registers each as a ChatSessionCustomizationItem.
 */

import * as vscode from 'vscode';
import type { DiagnosticsLogger } from './diagnostics.js';

export interface ChatCustomizationProviderContext {
  modelfilesFolder: string;
  diagnostics?: DiagnosticsLogger;
}

/**
 * Create the chat session customization provider for Modelfiles.
 * Returns a provider that scans the modelfiles folder and returns customization items.
 */
export function createChatCustomizationProvider(ctx: ChatCustomizationProviderContext) {
  const changeEmitter = new vscode.EventEmitter<void>();

  return {
    /**
     * Get all Modelfile customization items.
     */
    async getCustomizationItems(_session: any, _token: any): Promise<any> {
      if ((_token as any)?.isCancellationRequested) return [];

      try {
        const modelfilesUri = vscode.Uri.parse(ctx.modelfilesFolder);
        const files = await vscode.workspace.fs.readDirectory(modelfilesUri);

        const items: vscode.ChatSessionCustomizationItem[] = [];

        for (const [name, fileType] of files) {
          if (fileType !== vscode.FileType.File) continue;
          if (!name.endsWith('.modelfile')) continue;

          const uri = vscode.Uri.joinPath(modelfilesUri, name);
          const id = name.replace('.modelfile', '');

          items.push({
            id,
            label: id,
            description: `Custom Modelfile: ${name}`,
            type: vscode.ChatSessionCustomizationType.Agent,
            uri,
          });
        }

        ctx.diagnostics?.debug?.(`[chat-customization] found ${items.length} modelfiles`);
        return items;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.diagnostics?.debug?.(`[chat-customization] failed to read modelfiles: ${msg}`);
        return [];
      }
    },

    /**
     * File watcher for modelfiles folder changes.
     */
    get onDidChange(): vscode.Event<void> {
      return changeEmitter.event;
    },

    /**
     * Dispose the provider.
     */
    dispose() {
      changeEmitter.dispose();
    },
  };
}

/**
 * Register the chat session customization provider.
 * Must be called during extension activation.
 */
export function registerChatCustomizationProvider(ctx: ChatCustomizationProviderContext): vscode.Disposable {
  try {
    // Guard: only available on VS Code with proposed API
    if (typeof (vscode.chat as any).registerChatSessionCustomizationProvider !== 'function') {
      return new vscode.Disposable(() => {});
    }

    const provider = createChatCustomizationProvider(ctx);

    const disposable = (vscode.chat as any).registerChatSessionCustomizationProvider(
      'opilot',
      {
        label: 'Ollama Modelfiles',
        iconId: 'hubot',
      },
      provider,
    );

    // Set up file watcher for modelfiles folder
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.parse(ctx.modelfilesFolder), '*.modelfile'),
    );

    const onChanged = () => {
      // Trigger provider update via onDidChange event
      if ((provider as any).onDidChange) {
        (provider as any).onDidChange?.fire?.();
      }
    };

    watcher.onDidCreate(onChanged);
    watcher.onDidDelete(onChanged);
    watcher.onDidChange(onChanged);

    return vscode.Disposable.from(disposable, watcher);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.diagnostics?.debug?.(`[chat-customization] registration failed: ${msg}`);
    return new vscode.Disposable(() => {});
  }
}
