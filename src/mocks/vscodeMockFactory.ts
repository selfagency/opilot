export function deepMerge<T>(target: T, source: Partial<T>): T {
  if (!source) return target;
  const out: any = Array.isArray(target) ? [...(target as any)] : { ...(target as any) };
  for (const key of Object.keys(source as any)) {
    const srcVal: any = (source as any)[key];
    const tgtVal: any = (target as any)[key];
    if (srcVal && typeof srcVal === 'object' && !Array.isArray(srcVal) && tgtVal && typeof tgtVal === 'object') {
      out[key] = deepMerge(tgtVal, srcVal);
    } else {
      out[key] = srcVal;
    }
  }
  return out;
}

export function createVscodeMock(overrides: any = {}) {
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
      withProgress: async (_options: any, callback: any) => callback({}),
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
      joinPath: (_base: any, _path: string) => ({ fsPath: _path }),
    },
    ChatResponseMarkdownPart: class {
      value: any = {};
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
  } as any;

  return deepMerge(base, overrides) as any;
}

export default createVscodeMock;
