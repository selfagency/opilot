import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type PackageJson = {
  contributes?: {
    viewsContainers?: {
      activitybar?: Array<{ id: string; icon?: string }>;
    };
    views?: Record<string, Array<{ id: string; type?: string }>>;
    commands?: Array<{ command: string; title?: string; category?: string; icon?: string }>;
    menus?: {
      'view/title'?: Array<{ command: string; when?: string; group?: string }>;
      'view/item/context'?: Array<{ command: string; when?: string; group?: string }>;
    };
    languageModelChatProviders?: Array<{ vendor: string }>;
    configuration?: {
      properties?: Record<
        string,
        {
          type?: string;
          default?: unknown;
          description?: string;
          markdownDescription?: string;
          deprecationMessage?: string;
        }
      >;
    };
  };
  activationEvents?: string[];
};

function loadPackageJson(): PackageJson {
  const packagePath = resolve(__dirname, '..', 'package.json');
  const raw = readFileSync(packagePath, 'utf8');
  return JSON.parse(raw) as PackageJson;
}

function extractViewId(whenClause?: string): string | undefined {
  if (!whenClause) {
    return undefined;
  }

  const match = whenClause.match(/view\s*==\s*([a-z0-9-]+)/i);
  return match?.[1];
}

describe('package contributes integrity', () => {
  it('references only declared commands from view menus', () => {
    const pkg = loadPackageJson();
    const commands = new Set((pkg.contributes?.commands ?? []).map(command => command.command));
    const titleMenuCommands = (pkg.contributes?.menus?.['view/title'] ?? []).map(menu => menu.command);
    const contextMenuCommands = (pkg.contributes?.menus?.['view/item/context'] ?? []).map(menu => menu.command);

    const unknown = [...titleMenuCommands, ...contextMenuCommands].filter(command => !commands.has(command));

    expect(unknown).toEqual([]);
  });

  it('uses valid view IDs in view menu when clauses', () => {
    const pkg = loadPackageJson();
    const allViews = Object.values(pkg.contributes?.views ?? {}).flat();
    const viewIds = new Set(allViews.map(view => view.id));

    const titleViews = (pkg.contributes?.menus?.['view/title'] ?? [])
      .map(menu => extractViewId(menu.when))
      .filter((id): id is string => Boolean(id));

    const contextViews = (pkg.contributes?.menus?.['view/item/context'] ?? [])
      .map(menu => extractViewId(menu.when))
      .filter((id): id is string => Boolean(id));

    const invalid = [...titleViews, ...contextViews].filter(id => !viewIds.has(id));

    expect(invalid).toEqual([]);
  });

  it('keeps language model activation event aligned with provider vendor', () => {
    const pkg = loadPackageJson();
    const vendor = pkg.contributes?.languageModelChatProviders?.[0]?.vendor;

    expect(vendor).toBeTruthy();
    expect(pkg.activationEvents).toContain(`onLanguageModelChatProvider:${vendor}`);
  });

  it('references an existing activity bar icon file', () => {
    const pkg = loadPackageJson();
    const icon = pkg.contributes?.viewsContainers?.activitybar?.[0]?.icon;

    expect(icon).toBeTruthy();
    const iconPath = resolve(__dirname, '..', icon!);
    expect(existsSync(iconPath)).toBe(true);
  });

  it('declares the ollama-modelfiles view', () => {
    const pkg = loadPackageJson();
    const explorerViews = pkg.contributes?.views?.['ollama-explorer'] ?? [];
    const ids = explorerViews.map(view => view.id);
    expect(ids).toContain('ollama-modelfiles');
  });

  it('all commands have "Ollama" category', () => {
    const pkg = loadPackageJson();
    type PkgCommand = { command: string; category?: string };
    const commands = (pkg.contributes?.commands ?? []) as PkgCommand[];
    const missing = commands.filter(c => c.category !== 'Ollama').map(c => c.command);
    expect(missing).toEqual([]);
  });

  it('all view/title navigation-group commands have an icon', () => {
    const pkg = loadPackageJson();
    const commandIconMap = new Map((pkg.contributes?.commands ?? []).map(c => [c.command, c.icon]));
    const navMenuEntries = (pkg.contributes?.menus?.['view/title'] ?? []).filter(
      entry => typeof entry.group === 'string' && entry.group.startsWith('navigation'),
    );
    const missingIcon = navMenuEntries.filter(entry => !commandIconMap.get(entry.command)).map(entry => entry.command);
    expect(missingIcon).toEqual([]);
  });

  it('declares opilot.completionModel configuration property', () => {
    const pkg = loadPackageJson();
    const prop = pkg.contributes?.configuration?.properties?.['opilot.completionModel'];
    expect(prop).toBeDefined();
    expect(prop?.type).toBe('string');
  });

  it('declares opilot.enableInlineCompletions configuration property', () => {
    const pkg = loadPackageJson();
    const prop = pkg.contributes?.configuration?.properties?.['opilot.enableInlineCompletions'];
    expect(prop).toBeDefined();
    expect(prop?.type).toBe('boolean');
    expect(prop?.default).toBe(true);
  });

  it('does not declare legacy ollama.* settings in contributes.configuration', () => {
    const pkg = loadPackageJson();
    const properties = pkg.contributes?.configuration?.properties ?? {};
    const legacyKeys = [
      'ollama.host',
      'ollama.localModelRefreshInterval',
      'ollama.libraryRefreshInterval',
      'ollama.streamLogs',
      'ollama.diagnostics.logLevel',
      'ollama.modelfilesPath',
      'ollama.completionModel',
      'ollama.enableInlineCompletions',
      'ollama.hideThinkingContent',
    ];

    for (const key of legacyKeys) {
      expect(Object.hasOwn(properties, key)).toBe(false);
    }
  });

  it('does not declare the ollama-model-preview webview view', () => {
    const pkg = loadPackageJson();
    const views = pkg.contributes?.views;
    const explorerViews =
      views && Object.hasOwn(views, 'ollama-explorer') && Array.isArray(views['ollama-explorer'])
        ? views['ollama-explorer']
        : [];
    const ids = explorerViews.map(view => view.id);
    expect(ids).not.toContain('ollama-model-preview');
  });

  it('does not declare the previewLibraryModel command', () => {
    const pkg = loadPackageJson();
    const commands = (pkg.contributes?.commands ?? []).map(c => c.command);
    expect(commands).not.toContain('opilot.previewLibraryModel');
  });

  it('does not include previewLibraryModel in context menus', () => {
    const pkg = loadPackageJson();
    const contextCommands = (pkg.contributes?.menus?.['view/item/context'] ?? []).map(m => m.command);
    expect(contextCommands).not.toContain('opilot.previewLibraryModel');
  });

  it('all grammar keywords have hover documentation', () => {
    const grammarPath = resolve(__dirname, '..', 'syntaxes', 'modelfile.tmLanguage.json');
    const grammarRaw = readFileSync(grammarPath, 'utf8');
    const grammar = JSON.parse(grammarRaw);

    // Extract KEYWORD_DOCS from modelfiles.ts source to avoid vscode dependency
    const modelfilesPath = resolve(__dirname, 'modelfiles.ts');
    const modelfilesSource = readFileSync(modelfilesPath, 'utf8');
    const keywordNamesInSource = Array.from(modelfilesSource.matchAll(/^\s+([A-Z]+):\s+['"`]/gm), m => m[1]);

    // Extract keyword names from the grammar match pattern
    // Pattern: ^(FROM|PARAMETER|...|DESCRIPTION)\b
    const keywordPattern = grammar.patterns.find((p: any) => p.match?.includes('FROM'));
    expect(keywordPattern).toBeDefined();
    const rawMatch = keywordPattern.match as string;
    const keywords = rawMatch
      .replace(/^\^\(/, '')
      .replace(/\)\\b$/, '')
      .split('|');

    const undocumented = keywords.filter((k: string) => !keywordNamesInSource.includes(k));
    expect(undocumented).toEqual([]); // All grammar keywords must have docs
  });
});
