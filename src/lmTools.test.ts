import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock vscode with our local test helper
vi.doMock('vscode', () => ({ ...(require('./test/vscode.mock') as any) }));

// Import the module under test after mocking
import { registerOpilotLmTools } from './lmTools';

describe('lmTools registration', () => {
  beforeEach(() => {
    // noop
  });

  it('registers expected tools (returns disposables)', async () => {
    const mockClient: any = {
      list: vi.fn().mockResolvedValue({ models: [{ name: 'llama2', size: 123 }] }),
      ps: vi.fn().mockResolvedValue({ models: [] }),
      pull: vi.fn().mockResolvedValue(undefined),
    };

    const mockLocalProvider: any = {
      startModel: vi.fn().mockResolvedValue(undefined),
      stopModel: vi.fn().mockResolvedValue(undefined),
      refresh: vi.fn(),
    };

    const mockContext: any = { subscriptions: [] };
    const mockDiagnostics: any = { exception: vi.fn(), info: vi.fn() };

    const disposables = registerOpilotLmTools(mockContext, mockClient, mockLocalProvider, mockDiagnostics as any);

    // The registration should return an array of disposables and also push them into context.subscriptions
    expect(Array.isArray(disposables)).toBe(true);
    expect(mockContext.subscriptions.length).toBeGreaterThanOrEqual(disposables.length);
  });
});
