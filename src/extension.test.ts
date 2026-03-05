import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('activate', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('should be importable', async () => {
    // Mock vscode and ollama before importing extension
    vi.doMock('vscode', () => ({
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
        fire = vi.fn();
      },
      window: {
        registerTreeDataProvider: vi.fn(() => ({ dispose: vi.fn() })),
        createOutputChannel: vi.fn(() => ({
          info: vi.fn(),
          error: vi.fn(),
          log: vi.fn(),
        })),
        showInputBox: vi.fn(),
        showErrorMessage: vi.fn(),
        showInformationMessage: vi.fn(),
        withProgress: vi.fn(async (_options: any, callback: any) => callback({})),
      },
      commands: {
        registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
        executeCommand: vi.fn(),
      },
      workspace: {
        getConfiguration: vi.fn(() => ({
          get: vi.fn(),
        })),
        onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
      },
      lm: {
        registerLanguageModelChatProvider: vi.fn(() => ({ dispose: vi.fn() })),
      },
      chat: {
        createChatParticipant: vi.fn(() => ({
          iconPath: undefined,
        })),
      },
      Uri: {
        joinPath: vi.fn((_base: any, _path: string) => ({ fsPath: _path })),
      },
      ChatResponseMarkdownPart: class {
        value: any = {};
      },
      LanguageModelChatMessage: {
        User: vi.fn(),
        Assistant: vi.fn(),
      },
      LanguageModelTextPart: class {},
      CancellationToken: class {},
    }));

    vi.doMock('ollama', () => ({
      Ollama: class {
        list = vi.fn().mockResolvedValue({ models: [] });
        ps = vi.fn().mockResolvedValue({ models: [] });
        show = vi.fn().mockResolvedValue({ template: '' });
      },
    }));

    // Now import after mocking
    const ext = await import('./extension.js');
    expect(ext).toBeDefined();
  });
});
