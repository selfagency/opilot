import * as vscode from 'vscode';

export const SETTINGS_NAMESPACE = 'opilot';
export const LEGACY_SETTINGS_NAMESPACE = 'ollama';

export const SUPPORTED_SETTING_KEYS = [
  'host',
  'localModelRefreshInterval',
  'libraryRefreshInterval',
  'streamLogs',
  'diagnostics.logLevel',
  'modelfilesPath',
  'completionModel',
  'enableInlineCompletions',
  'hideThinkingContent',
  'repetitionDetection',
  'maxContextTokens',
] as const;

type SupportedSettingKey = (typeof SUPPORTED_SETTING_KEYS)[number];

type LoggerLike = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
  debug?: (message: string) => void;
};

type InspectResult<T> = {
  defaultValue?: T;
  globalValue?: T;
  workspaceValue?: T;
  workspaceFolderValue?: T;
};

function inspectSetting<T>(config: unknown, key: string): InspectResult<T> | undefined {
  if (!config || typeof config !== 'object') {
    return undefined;
  }

  const inspect = (config as { inspect?: (k: string) => InspectResult<T> }).inspect;
  if (typeof inspect !== 'function') {
    return undefined;
  }

  return inspect(key);
}

export function getSetting<T>(key: SupportedSettingKey): T | undefined;
export function getSetting<T>(key: SupportedSettingKey, defaultValue: T): T;
export function getSetting<T>(key: SupportedSettingKey, defaultValue?: T): T | undefined {
  const opilotConfig = vscode.workspace.getConfiguration(SETTINGS_NAMESPACE);
  const legacyConfig = vscode.workspace.getConfiguration(LEGACY_SETTINGS_NAMESPACE);

  const opilotInspect = inspectSetting<T>(opilotConfig, key);
  const legacyInspect = inspectSetting<T>(legacyConfig, key);

  // Test/mocked environments may provide WorkspaceConfiguration#get without
  // inspect(). Fall back to value-based precedence in that case.
  if (!opilotInspect || !legacyInspect) {
    const primary = opilotConfig.get<T>(key);
    if (primary !== undefined) {
      return primary;
    }
    const legacy = legacyConfig.get<T>(key);
    if (legacy !== undefined) {
      return legacy;
    }
    return defaultValue;
  }

  const hasOpilotExplicitValue =
    opilotInspect?.globalValue !== undefined ||
    opilotInspect?.workspaceValue !== undefined ||
    opilotInspect?.workspaceFolderValue !== undefined;
  if (hasOpilotExplicitValue) {
    return opilotConfig.get<T>(key) as T;
  }

  const hasLegacyExplicitValue =
    legacyInspect?.globalValue !== undefined ||
    legacyInspect?.workspaceValue !== undefined ||
    legacyInspect?.workspaceFolderValue !== undefined;
  if (hasLegacyExplicitValue) {
    return legacyConfig.get<T>(key) as T;
  }

  if (opilotInspect?.defaultValue !== undefined) {
    return opilotInspect.defaultValue as T;
  }

  return defaultValue;
}

export function affectsSetting(event: vscode.ConfigurationChangeEvent, key: SupportedSettingKey): boolean {
  return (
    event.affectsConfiguration(`${SETTINGS_NAMESPACE}.${key}`) ||
    event.affectsConfiguration(`${LEGACY_SETTINGS_NAMESPACE}.${key}`)
  );
}

export async function migrateLegacySettings(logger?: LoggerLike): Promise<SupportedSettingKey[]> {
  const migrated: SupportedSettingKey[] = [];
  const opilotConfig = vscode.workspace.getConfiguration(SETTINGS_NAMESPACE);
  const legacyConfig = vscode.workspace.getConfiguration(LEGACY_SETTINGS_NAMESPACE);

  for (const key of SUPPORTED_SETTING_KEYS) {
    try {
      if (await migrateSettingKey(key, opilotConfig, legacyConfig)) {
        migrated.push(key);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger?.warn?.(`[settings] failed to migrate legacy key ${LEGACY_SETTINGS_NAMESPACE}.${key}: ${message}`);
    }
  }

  if (migrated.length > 0) {
    logger?.info?.(
      `[settings] migrated legacy settings (${LEGACY_SETTINGS_NAMESPACE}.* → ${SETTINGS_NAMESPACE}.*): ${migrated.join(', ')}`,
    );
  } else {
    logger?.debug?.('[settings] no legacy settings required migration');
  }

  return migrated;
}

async function migrateWorkspaceFolders(key: SupportedSettingKey): Promise<boolean> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  let migratedAny = false;
  for (const folder of folders) {
    const legacyFolderConfig = vscode.workspace.getConfiguration(LEGACY_SETTINGS_NAMESPACE, folder.uri);
    const opilotFolderConfig = vscode.workspace.getConfiguration(SETTINGS_NAMESPACE, folder.uri);
    const legacyFolderInspect = inspectSetting<unknown>(legacyFolderConfig, key);
    const opilotFolderInspect = inspectSetting<unknown>(opilotFolderConfig, key);
    if (
      legacyFolderInspect?.workspaceFolderValue !== undefined &&
      opilotFolderInspect?.workspaceFolderValue === undefined
    ) {
      await opilotFolderConfig.update(
        key,
        legacyFolderInspect.workspaceFolderValue,
        vscode.ConfigurationTarget.WorkspaceFolder,
      );
      await legacyFolderConfig.update(key, undefined, vscode.ConfigurationTarget.WorkspaceFolder);
      migratedAny = true;
    }
  }
  return migratedAny;
}

async function migrateSettingKey(
  key: SupportedSettingKey,
  opilotConfig: vscode.WorkspaceConfiguration,
  legacyConfig: vscode.WorkspaceConfiguration,
): Promise<boolean> {
  const opilotInspect = inspectSetting<unknown>(opilotConfig, key);
  const legacyInspect = inspectSetting<unknown>(legacyConfig, key);

  if (!legacyInspect) {
    return false;
  }

  let didMigrate = false;

  if (legacyInspect.globalValue !== undefined && opilotInspect?.globalValue === undefined) {
    await opilotConfig.update(key, legacyInspect.globalValue, vscode.ConfigurationTarget.Global);
    await legacyConfig.update(key, undefined, vscode.ConfigurationTarget.Global);
    didMigrate = true;
  }

  if (legacyInspect.workspaceValue !== undefined && opilotInspect?.workspaceValue === undefined) {
    await opilotConfig.update(key, legacyInspect.workspaceValue, vscode.ConfigurationTarget.Workspace);
    await legacyConfig.update(key, undefined, vscode.ConfigurationTarget.Workspace);
    didMigrate = true;
  }

  if (await migrateWorkspaceFolders(key)) {
    didMigrate = true;
  }

  return didMigrate;
}
