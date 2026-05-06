function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  if (!source) return target;
  const out: Record<string, unknown> = { ...target };
  // nosemgrep: javascript.lang.security.detect-object-injection
  // Test-only deep merge helper: keys come from Object.entries(source) and are not user-controlled.
  for (const [key, srcVal] of Object.entries(source as Record<string, unknown>)) {
    if (!Object.hasOwn(source, key)) {
      continue;
    }

    const tgtVal = (target as Record<string, unknown>)[key];
    if (isRecord(srcVal) && isRecord(tgtVal)) {
      out[key] = deepMerge(tgtVal, srcVal);
      continue;
    }

    out[key] = srcVal;
  }
  return out as T;
}

export function createVscodeMock(overrides: Record<string, unknown> = {}) {
  const base = {
    TreeItem: class {
      constructor(public label: string) {}
    },
    TreeItemCollapsibleState: {
      None: 0,
      Collapsed: 1,
      Expanded: 2,
    },
    EventEmitter: class {
      event = {};
      fire = () => {};
    },
    StatusBarAlignment: { Right: 2 },
    MarkdownString: class {
      constructor(public value: string) {}
    },
    ThemeColor: class {
      constructor(public id: string) {}
    },
    window: {
      createStatusBarItem: () => ({
        text: '',
        tooltip: undefined,
        command: undefined,
        show: () => {},
        dispose: () => {},
      }),
      registerTreeDataProvider: () => ({ dispose: () => {} }),
      registerWebviewViewProvider: () => ({ dispose: () => {} }),
      createOutputChannel: () => ({
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
        log: () => {},
        show: () => {},
      }),
      showInputBox: () => {},
      showErrorMessage: () => {},
      showInformationMessage: () => {},
      withProgress: async (_options: unknown, callback: (progress: Record<string, never>) => unknown) => callback({}),
    },
    commands: {
      registerCommand: () => ({ dispose: () => {} }),
      executeCommand: () => {},
    },
    workspace: {
      getConfiguration: () => ({ get: (_k: string) => undefined }),
      onDidChangeConfiguration: () => ({ dispose: () => {} }),
    },
    lm: {
      registerLanguageModelChatProvider: () => ({ dispose: () => {} }),
    },
    languages: {
      registerInlineCompletionItemProvider: () => ({ dispose: () => {} }),
    },
    chat: {
      createChatParticipant: () => ({ iconPath: undefined, dispose: () => {} }),
    },
    Uri: {
      file: (path: string) => ({ fsPath: path }),
      joinPath: (_base: unknown, _path: string) => ({ fsPath: _path }),
    },
    ChatResponseMarkdownPart: class {
      value: Record<string, unknown> = {};
    },
    LanguageModelChatMessage: {
      User: () => {},
      Assistant: () => {},
    },
    LanguageModelTextPart: class {},
    CancellationToken: class {},
    InlineCompletionItem: class {
      constructor(public readonly insertText: string) {}
    },
    Disposable: class {
      constructor(public dispose: () => void) {}
      static from(...disposables: Array<{ dispose?: () => void }>) {
        return {
          dispose: () => {
            for (const disposable of disposables) {
              disposable.dispose?.();
            }
          },
        };
      }
    },
  } as Record<string, unknown>;

  return deepMerge(base, overrides);
}

export default createVscodeMock;
