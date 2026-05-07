import { promises as fsPromises } from 'node:fs';
import { dirname, join } from 'node:path';
import * as vscode from 'vscode';
import { isSelectedAction } from '../extensionHelpers.js';
import { builtInOllamaConflictPromptInProgress as builtInOllamaConflictPromptInProgressExported } from '../participantOrchestration';
import { homedir } from 'node:os';

const MAX_WRITE_RETRIES = 3;
let builtInOllamaConflictPromptInProgress = builtInOllamaConflictPromptInProgressExported;

/**
 * Update chat language models JSON file with bounded compare-and-retry logic.
 * Retries up to maxRetries if file changes between read and write.
 */
async function tryUpdateChatLanguageModelsFile(modelsPath: string, maxRetries: number): Promise<boolean> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const raw = await fsPromises.readFile(modelsPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        break;
      }

      const filtered = parsed.filter(
        item => !(item && typeof item === 'object' && (item as Record<string, unknown>).vendor === 'ollama'),
      );

      if (filtered.length === parsed.length) {
        break;
      }

      const latestRaw = await fsPromises.readFile(modelsPath, 'utf8');
      if (latestRaw !== raw) {
        if (attempt < maxRetries - 1) {
          continue;
        }
        break;
      }

      await fsPromises.writeFile(modelsPath, `${JSON.stringify(filtered, null, 2)}\n`, 'utf8');
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[opilot] failed to update chat language models file (${modelsPath}): ${message}`);
      break;
    }
  }
  return false;
}

/**
 * Remove Copilot's built-in Ollama provider from all chat language models JSON files.
 * Scans profile-scoped and user-global config locations across platforms.
 */
async function removeBuiltInOllamaFromChatLanguageModels(
  context: Pick<vscode.ExtensionContext, 'globalStorageUri'>,
): Promise<boolean> {
  const candidatePaths = new Set<string>();

  // globalStorageUri: .../profiles/<profile-id>/globalStorage/<extension-id>
  // or .../User/globalStorage/<extension-id>
  const profileDir = dirname(dirname(context.globalStorageUri.fsPath));
  candidatePaths.add(join(profileDir, 'chatLanguageModels.json'));

  // Standard VS Code user folders per platform where profile data lives.
  const userDirs: string[] = [];
  if (process.platform === 'darwin') {
    userDirs.push(join(homedir(), 'Library', 'Application Support', 'Code', 'User'));
  } else if (process.platform === 'win32') {
    const appData = process.env['APPDATA'];
    if (appData) {
      userDirs.push(join(appData, 'Code', 'User'));
    }
  } else {
    // Linux (and other POSIX)
    const xdgConfig = process.env['XDG_CONFIG_HOME'] || join(homedir(), '.config');
    userDirs.push(join(xdgConfig, 'Code', 'User'));
  }

  for (const userDir of userDirs) {
    candidatePaths.add(join(userDir, 'chatLanguageModels.json'));
  }

  // Profile-scoped files: User/profiles/<id>/chatLanguageModels.json
  for (const userDir of userDirs) {
    try {
      const profilesDir = join(userDir, 'profiles');
      const entries = await fsPromises.readdir(profilesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          candidatePaths.add(join(profilesDir, entry.name, 'chatLanguageModels.json'));
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.debug(`[opilot] skipping profiles directory scan for ${userDir}: ${message}`);
    }
  }

  let changed = false;

  for (const modelsPath of candidatePaths) {
    if (await tryUpdateChatLanguageModelsFile(modelsPath, MAX_WRITE_RETRIES)) {
      changed = true;
    }
  }

  return changed;
}

/**
 * Disable Copilot's built-in Ollama provider via configuration or file mutation fallback.
 */
async function disableBuiltInOllamaProvider(
  ws: Pick<typeof vscode.workspace, 'getConfiguration'>,
  win: Pick<typeof vscode.window, 'showErrorMessage'>,
  context?: Pick<vscode.ExtensionContext, 'globalStorageUri'>,
): Promise<boolean> {
  try {
    await (ws.getConfiguration('github.copilot.chat') as vscode.WorkspaceConfiguration).update(
      'ollama.url',
      '',
      vscode.ConfigurationTarget.Global,
    );
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('not a registered configuration') && context) {
      try {
        return await removeBuiltInOllamaFromChatLanguageModels(context);
      } catch (fallbackError) {
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        await win.showErrorMessage(`Failed to disable Copilot's built-in Ollama provider: ${fallbackMessage}`);
        return false;
      }
    } else {
      await win.showErrorMessage(`Failed to disable Copilot's built-in Ollama provider: ${message}`);
      return false;
    }
  }
}

/**
 * Show warning prompt to user about disabling built-in Ollama provider.
 */
async function promptDisableBuiltInProvider(win: Pick<typeof vscode.window, 'showWarningMessage'>): Promise<boolean> {
  const selection = await win.showWarningMessage(
    "Copilot's built-in Ollama provider is active and will show duplicate models alongside this extension. Disable it?",
    'Disable Built-in Ollama Provider',
  );
  return isSelectedAction(selection, 'Disable Built-in Ollama Provider');
}

/**
 * Show information prompt to user after disabling built-in provider.
 */
async function promptReloadAfterDisable(
  win: Pick<typeof vscode.window, 'showInformationMessage'>,
  commands: Pick<typeof vscode.commands, 'executeCommand'>,
): Promise<void> {
  const reloadSelection = await win.showInformationMessage(
    "Copilot's built-in Ollama provider has been disabled. Reload VS Code to apply.",
    'Reload Window',
  );

  if (isSelectedAction(reloadSelection, 'Reload Window')) {
    await commands.executeCommand('workbench.action.reloadWindow');
  }
}

/**
 * Check if Copilot's built-in Ollama provider has any registered models.
 */
async function hasBuiltInOllamaModels(lmApi: Pick<typeof vscode.lm, 'selectChatModels'>): Promise<boolean> {
  const conflictModels = await lmApi.selectChatModels({ vendor: 'ollama' });
  return conflictModels.length > 0;
}

/**
 * Execute full conflict resolution flow: prompt → disable → reload.
 */
async function resolveBuiltInOllamaConflictFlow(
  win: Pick<typeof vscode.window, 'showWarningMessage' | 'showInformationMessage' | 'showErrorMessage'>,
  ws: Pick<typeof vscode.workspace, 'getConfiguration'>,
  commands: Pick<typeof vscode.commands, 'executeCommand'>,
  context?: Pick<vscode.ExtensionContext, 'globalStorageUri'>,
): Promise<void> {
  if (!(await promptDisableBuiltInProvider(win))) return;

  const disabled = await disableBuiltInOllamaProvider(ws, win, context);

  if (!disabled) {
    await win.showErrorMessage(
      'Built-in Ollama provider appears to still be enabled. Please disable it in Chat Language Models settings.',
    );
    return;
  }

  await promptReloadAfterDisable(win, commands);
}

/**
 * Detect and offer to disable Copilot's conflicting built-in Ollama provider.
 * Detects via LM models registered under vendor 'ollama'.
 */
export async function handleBuiltInOllamaConflict(
  windowApi?: Pick<typeof vscode.window, 'showWarningMessage' | 'showInformationMessage' | 'showErrorMessage'>,
  workspaceApi?: Pick<typeof vscode.workspace, 'getConfiguration'>,
  lmApi?: Pick<typeof vscode.lm, 'selectChatModels'>,
  commandsApi?: Pick<typeof vscode.commands, 'executeCommand'>,
  context?: Pick<vscode.ExtensionContext, 'globalStorageUri'>,
): Promise<void> {
  if (builtInOllamaConflictPromptInProgress) {
    return;
  }

  const win = windowApi ?? vscode.window;
  const ws = workspaceApi ?? vscode.workspace;
  const lm = lmApi ?? vscode.lm;
  const commands = commandsApi ?? vscode.commands;

  if (!(await hasBuiltInOllamaModels(lm))) return;

  builtInOllamaConflictPromptInProgress = true;
  try {
    await resolveBuiltInOllamaConflictFlow(win, ws, commands, context);
  } finally {
    builtInOllamaConflictPromptInProgress = false;
  }
}
