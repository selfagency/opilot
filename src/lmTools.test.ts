import type { Ollama } from 'ollama';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import type { DiagnosticsLogger } from './diagnostics.js';
import type { LocalModelsProvider } from './sidebar.js';

type ToolHandler = (input: Record<string, unknown>, token: unknown) => unknown | Promise<unknown>;

// Mock vscode with our local test helper
vi.doMock('vscode', () => ({ ...(require('./test/vscode.mock') as Record<string, unknown>) }));

// Import the module under test after mocking
import { registerOpilotLmTools } from './lmTools';

describe('lmTools registration', () => {
  beforeEach(() => {
    // noop
  });

  it('registers expected tools (returns disposables)', async () => {
    const mockClient = {
      list: vi.fn().mockResolvedValue({ models: [{ name: 'llama2', size: 123 }] }),
      ps: vi.fn().mockResolvedValue({ models: [] }),
      pull: vi.fn().mockResolvedValue(undefined),
    } as unknown as Ollama;

    const mockLocalProvider = {
      startModel: vi.fn().mockResolvedValue(undefined),
      stopModel: vi.fn().mockResolvedValue(undefined),
      refresh: vi.fn(),
    } as unknown as LocalModelsProvider;

    const mockContext = { subscriptions: [] } as unknown as vscode.ExtensionContext;
    const mockDiagnostics = { exception: vi.fn(), info: vi.fn() } as unknown as DiagnosticsLogger;

    const disposables = registerOpilotLmTools(mockContext, mockClient, mockLocalProvider, mockDiagnostics);

    // The registration should return an array of disposables and also push them into context.subscriptions
    expect(Array.isArray(disposables)).toBe(true);
    expect(mockContext.subscriptions.length).toBeGreaterThanOrEqual(disposables.length);
  });

  it('registered tools are callable via vscode.lm mock', async () => {
    // Reset modules to mock vscode differently for this test
    const registrations: Record<string, ToolHandler> = {};
    // Clear module cache so we can re-mock 'vscode' safely for this case
    vi.resetModules();
    // Minimal vscode mock for this test: only the pieces used by lmTools
    const mockVscode: Record<string, unknown> = {
      lm: {
        registerTool: vi.fn((name: string, _schema: unknown, handler: ToolHandler) => {
          registrations[name] = handler;
          return { dispose: vi.fn() };
        }),
      },
      // LanguageModelTextPart used to wrap results
      LanguageModelTextPart: class {
        constructor(public value: string) {}
      },
    };

    vi.doMock('vscode', () => mockVscode);

    // Re-import the module under test with the new mock
    const { registerOpilotLmTools } = await import('./lmTools');

    const mockClient = {
      list: vi.fn().mockResolvedValue({ models: [{ name: 'mymodel', size: 10 }] }),
      ps: vi.fn().mockResolvedValue({ models: [] }),
      pull: vi.fn().mockResolvedValue(undefined),
    } as unknown as Ollama;

    const mockLocalProvider = {
      startModel: vi.fn().mockResolvedValue(undefined),
      stopModel: vi.fn().mockResolvedValue(undefined),
      refresh: vi.fn(),
    } as unknown as LocalModelsProvider;

    const mockContext = { subscriptions: [] } as unknown as vscode.ExtensionContext;
    const mockDiagnostics = { exception: vi.fn(), info: vi.fn() } as unknown as DiagnosticsLogger;

    registerOpilotLmTools(mockContext, mockClient, mockLocalProvider, mockDiagnostics);

    // Ensure the list tool was registered and then invoke its handler
    expect(Object.keys(registrations).length).toBeGreaterThan(0);
    expect(typeof registrations.opilot_list_models).toBe('function');

    const result = await registrations.opilot_list_models({}, {});
    // Handler returns { content: [LanguageModelTextPart(JSON.stringify(...))] }
    expect(result).toBeDefined();
  });
});
