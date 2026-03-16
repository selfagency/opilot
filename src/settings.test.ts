import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ScopeValues = {
  defaultValue?: unknown;
  globalValue?: unknown;
  workspaceValue?: unknown;
  workspaceFolderValues?: Record<string, unknown>;
};

type ConfigStore = Record<string, ScopeValues>;

function createVscodeSettingsMock(options?: {
  opilot?: ConfigStore;
  legacy?: ConfigStore;
  workspaceFolders?: string[];
}) {
  const opilot = options?.opilot ?? {};
  const legacy = options?.legacy ?? {};
  const folders = options?.workspaceFolders ?? [];

  const getStore = (namespace: string): ConfigStore => {
    if (namespace === 'opilot') return opilot;
    if (namespace === 'ollama') return legacy;
    return {};
  };

  const getConfiguration = vi.fn((namespace: string, scopeUri?: { fsPath?: string }) => {
    const store = getStore(namespace);
    return {
      inspect: vi.fn((key: string) => {
        const scoped = store[key] ?? {};
        const folderKey = scopeUri?.fsPath;
        return {
          defaultValue: scoped.defaultValue,
          globalValue: scoped.globalValue,
          workspaceValue: scoped.workspaceValue,
          workspaceFolderValue: folderKey ? scoped.workspaceFolderValues?.[folderKey] : undefined,
        };
      }),
      get: vi.fn((key: string) => {
        const scoped = store[key] ?? {};
        const folderKey = scopeUri?.fsPath;
        if (folderKey && scoped.workspaceFolderValues && folderKey in scoped.workspaceFolderValues) {
          return scoped.workspaceFolderValues[folderKey];
        }
        if (scoped.workspaceValue !== undefined) return scoped.workspaceValue;
        if (scoped.globalValue !== undefined) return scoped.globalValue;
        return scoped.defaultValue;
      }),
      update: vi.fn(async (key: string, value: unknown, target: number) => {
        const scoped = (store[key] ??= {});
        if (target === 1) {
          scoped.globalValue = value;
          return;
        }
        if (target === 2) {
          scoped.workspaceValue = value;
          return;
        }
        if (target === 3) {
          const folderKey = scopeUri?.fsPath;
          if (!folderKey) return;
          if (!scoped.workspaceFolderValues) scoped.workspaceFolderValues = {};
          scoped.workspaceFolderValues[folderKey] = value;
        }
      }),
    };
  });

  return {
    workspace: {
      getConfiguration,
      workspaceFolders: folders.map(fsPath => ({ uri: { fsPath } })),
    },
    ConfigurationTarget: {
      Global: 1,
      Workspace: 2,
      WorkspaceFolder: 3,
    },
  };
}

describe('settings helpers', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('getSetting prefers explicit opilot value over legacy value', async () => {
    vi.doMock('vscode', () =>
      createVscodeSettingsMock({
        opilot: { host: { defaultValue: 'http://localhost:11434', globalValue: 'http://opilot:11434' } },
        legacy: { host: { defaultValue: 'http://localhost:11434', globalValue: 'http://legacy:11434' } },
      }),
    );

    const { getSetting } = await import('./settings.js');
    expect(getSetting<string>('host')).toBe('http://opilot:11434');
  });

  it('getSetting falls back to explicit legacy value when opilot has no explicit value', async () => {
    vi.doMock('vscode', () =>
      createVscodeSettingsMock({
        opilot: { host: { defaultValue: 'http://localhost:11434' } },
        legacy: { host: { defaultValue: 'http://localhost:11434', workspaceValue: 'http://legacy-workspace:11434' } },
      }),
    );

    const { getSetting } = await import('./settings.js');
    expect(getSetting<string>('host')).toBe('http://legacy-workspace:11434');
  });

  it('getSetting returns opilot default when neither namespace has explicit value', async () => {
    vi.doMock('vscode', () =>
      createVscodeSettingsMock({
        opilot: { host: { defaultValue: 'http://localhost:11434' } },
        legacy: { host: { defaultValue: 'http://localhost:11434' } },
      }),
    );

    const { getSetting } = await import('./settings.js');
    expect(getSetting<string>('host', 'fallback')).toBe('http://localhost:11434');
  });

  it('affectsSetting matches both opilot.* and ollama.* keys', async () => {
    vi.doMock('vscode', () => createVscodeSettingsMock());
    const { affectsSetting } = await import('./settings.js');

    const opilotEvent = {
      affectsConfiguration: (key: string) => key === 'opilot.streamLogs',
    } as any;
    const legacyEvent = {
      affectsConfiguration: (key: string) => key === 'ollama.streamLogs',
    } as any;

    expect(affectsSetting(opilotEvent, 'streamLogs')).toBe(true);
    expect(affectsSetting(legacyEvent, 'streamLogs')).toBe(true);
  });

  it('migrateLegacySettings migrates global/workspace and per-folder values independently', async () => {
    const folderA = '/workspace/a';
    const folderB = '/workspace/b';

    const vscodeMock = createVscodeSettingsMock({
      workspaceFolders: [folderA, folderB],
      opilot: {
        host: {
          defaultValue: 'http://localhost:11434',
          workspaceFolderValues: {
            [folderB]: 'http://existing-b:11434',
          },
        },
      },
      legacy: {
        host: {
          defaultValue: 'http://localhost:11434',
          globalValue: 'http://legacy-global:11434',
          workspaceValue: 'http://legacy-workspace:11434',
          workspaceFolderValues: {
            [folderA]: 'http://legacy-a:11434',
            [folderB]: 'http://legacy-b:11434',
          },
        },
      },
    });

    vi.doMock('vscode', () => vscodeMock);
    const { migrateLegacySettings } = await import('./settings.js');

    const migrated = await migrateLegacySettings();

    expect(migrated).toContain('host');

    // Global/workspace migrated
    expect((vscodeMock.workspace.getConfiguration('opilot') as any).inspect('host').globalValue).toBe(
      'http://legacy-global:11434',
    );
    expect((vscodeMock.workspace.getConfiguration('opilot') as any).inspect('host').workspaceValue).toBe(
      'http://legacy-workspace:11434',
    );

    // Folder A migrated (no existing opilot folder value)
    expect(
      (vscodeMock.workspace.getConfiguration('opilot', { fsPath: folderA }) as any).inspect('host')
        .workspaceFolderValue,
    ).toBe('http://legacy-a:11434');
    // Folder B preserved (existing opilot folder value)
    expect(
      (vscodeMock.workspace.getConfiguration('opilot', { fsPath: folderB }) as any).inspect('host')
        .workspaceFolderValue,
    ).toBe('http://existing-b:11434');
  });
});
