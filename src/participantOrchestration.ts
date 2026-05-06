import { promises as fsPromises } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Ollama } from 'ollama';
import * as vscode from 'vscode';
import type { DiagnosticsLogger } from './diagnostics.js';
import { isSelectedAction } from './extensionHelpers.js';
import { formatBytes } from './formatUtils.js';
import {
  createFollowupProvider,
  createParticipantDetectionProvider,
  createParticipantVariableProvider,
  createSummarizer,
  createTitleProvider,
  getAdditionalWelcomeMessage,
  getHelpTextPrefix,
} from './participantFeatures.js';
import { getSetting } from './settings.js';
import type { SidebarProfilingSnapshot } from './sidebar.js';

type ChatParticipantDetectionRegistrationApi = {
  registerChatParticipantDetectionProvider?: (
    id: string,
    provider: { detectChatParticipant?(input: string): boolean },
  ) => vscode.Disposable;
};

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

  const MAX_WRITE_RETRIES = 3;
  let changed = false;

  for (const modelsPath of candidatePaths) {
    if (await tryUpdateChatLanguageModelsFile(modelsPath, MAX_WRITE_RETRIES)) {
      changed = true;
    }
  }

  return changed;
}

export function logPerformanceSnapshot(
  diagnostics: DiagnosticsLogger,
  sidebarSnapshot?: SidebarProfilingSnapshot,
  label = 'manual',
): void {
  const memory = process.memoryUsage();

  const payload = {
    kind: 'performance_snapshot',
    label,
    timestamp: new Date().toISOString(),
    memory: {
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      externalBytes: memory.external,
      arrayBuffersBytes: memory.arrayBuffers,
      rss: formatBytes(memory.rss),
      heapUsed: formatBytes(memory.heapUsed),
      heapTotal: formatBytes(memory.heapTotal),
      external: formatBytes(memory.external),
      arrayBuffers: formatBytes(memory.arrayBuffers),
    },
    sidebar: sidebarSnapshot ?? null,
  };

  diagnostics.info(`[client] ${JSON.stringify(payload)}`);
}

/**
 * Set up chat participant with icon and register it
 */
export async function setupChatParticipant(
  context: vscode.ExtensionContext,
  participantHandler: vscode.ChatRequestHandler,
  chatApi?: Pick<typeof vscode.chat, 'createChatParticipant'>,
  client?: Ollama,
  diagnostics?: DiagnosticsLogger,
): Promise<vscode.Disposable> {
  const chat = chatApi || vscode.chat;
  const chatDetectionApi = vscode.chat as unknown as ChatParticipantDetectionRegistrationApi;
  const participantRecord = (value: vscode.ChatParticipant) => value as unknown as Record<string, unknown>;

  type OptionalParticipantFeatureName =
    | 'titleProvider'
    | 'summarizer'
    | 'additionalWelcomeMessage'
    | 'followupProvider'
    | 'participantVariableProvider';

  const setOptionalParticipantFeature = (featureName: OptionalParticipantFeatureName, value: unknown) => {
    try {
      const record = participantRecord(participant) as {
        titleProvider?: unknown;
        summarizer?: unknown;
        additionalWelcomeMessage?: unknown;
        followupProvider?: unknown;
        participantVariableProvider?: unknown;
      };
      switch (featureName) {
        case 'titleProvider':
          record.titleProvider = value;
          break;
        case 'summarizer':
          record.summarizer = value;
          break;
        case 'additionalWelcomeMessage':
          record.additionalWelcomeMessage = value;
          break;
        case 'followupProvider':
          record.followupProvider = value;
          break;
        case 'participantVariableProvider':
          record.participantVariableProvider = value;
          break;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      diagnostics?.debug?.(`[participantFeatures] skipping ${featureName}: ${message}`);
    }
  };

  const participant = chat.createChatParticipant('opilot.ollama', participantHandler);
  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'logo.png');
  participant.helpTextPrefix = getHelpTextPrefix();

  // Phase 5: Wire up Chat Participant providers
  if (client && diagnostics) {
    const modelId = getSetting<string>('selectedModel', 'llama3.2');
    const serverHost = getSetting<string>('host', 'http://localhost:11434');

    // Title provider
    const titleProvider = createTitleProvider({
      client,
      diagnostics,
      modelId,
      serverHost,
    });
    setOptionalParticipantFeature('titleProvider', titleProvider);

    // Summarizer
    const summarizer = createSummarizer({
      client,
      diagnostics,
      modelId,
      serverHost,
    });
    setOptionalParticipantFeature('summarizer', summarizer);

    // Welcome message
    setOptionalParticipantFeature(
      'additionalWelcomeMessage',
      await getAdditionalWelcomeMessage({
        client,
        diagnostics,
        modelId,
        serverHost,
      }),
    );

    // Followup provider
    const followupProvider = createFollowupProvider();
    setOptionalParticipantFeature('followupProvider', followupProvider);

    // Variable completions
    const varProvider = createParticipantVariableProvider({
      client,
      diagnostics,
      modelId,
      serverHost,
    });
    setOptionalParticipantFeature('participantVariableProvider', varProvider);

    // Phase 5.7: Detection provider
    const detectionProvider = createParticipantDetectionProvider();
    if (typeof chatDetectionApi.registerChatParticipantDetectionProvider === 'function') {
      chatDetectionApi.registerChatParticipantDetectionProvider('opilot.ollama', detectionProvider);
    }
  }

  return participant;
}

/**
 * Detect and offer to disable Copilot's conflicting built-in Ollama provider.
 * Detects via LM models registered under vendor 'ollama'.
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

async function promptDisableBuiltInProvider(win: Pick<typeof vscode.window, 'showWarningMessage'>): Promise<boolean> {
  const selection = await win.showWarningMessage(
    "Copilot's built-in Ollama provider is active and will show duplicate models alongside this extension. Disable it?",
    'Disable Built-in Ollama Provider',
  );
  return isSelectedAction(selection, 'Disable Built-in Ollama Provider');
}

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

async function hasBuiltInOllamaModels(lmApi: Pick<typeof vscode.lm, 'selectChatModels'>): Promise<boolean> {
  const conflictModels = await lmApi.selectChatModels({ vendor: 'ollama' });
  return conflictModels.length > 0;
}

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

let builtInOllamaConflictPromptInProgress = false;

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
