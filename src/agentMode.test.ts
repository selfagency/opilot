import { beforeEach, describe, expect, it, vi } from 'vitest';

function setupVscodeMock(agentModeEnabled: boolean) {
  vi.doMock('vscode', () => ({
    workspace: {
      getConfiguration: vi.fn(() => ({
        get: vi.fn((key: string, fallback: unknown) => {
          if (key === 'agentMode') {
            return agentModeEnabled;
          }
          return fallback;
        }),
      })),
    },
    Position: class {
      constructor(
        public line: number,
        public character: number,
      ) {}
    },
    Range: class {
      constructor(
        public start: { line: number; character: number },
        public end: { line: number; character: number },
      ) {}
    },
    TextEdit: {
      replace: (range: unknown, newText: string) => ({ range, newText }),
    },
    window: {
      showInformationMessage: vi.fn(),
    },
  }));
}

describe('agentMode', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('shouldUseAgentMode returns true for high-confidence edit intent with file cues', async () => {
    setupVscodeMock(true);
    const { shouldUseAgentMode } = await import('./agentMode.js');

    const result = shouldUseAgentMode(
      { permissionLevel: 'normal' },
      'please refactor this file src/extension.ts to simplify flow',
    );

    expect(result).toBe(true);
  });

  it('shouldUseAgentMode avoids low-confidence keyword-only prompts', async () => {
    setupVscodeMock(true);
    const { shouldUseAgentMode } = await import('./agentMode.js');

    const result = shouldUseAgentMode({ permissionLevel: 'normal' }, 'can you fix this explanation?');

    expect(result).toBe(false);
  });

  it('generateTextEdits replaces full document range using last existing line', async () => {
    setupVscodeMock(true);
    const { generateTextEdits } = await import('./agentMode.js');

    const edits = generateTextEdits('line1\nline2', 'updated');
    const edit = edits[0] as { range: { start: { line: number }; end: { line: number; character: number } } };

    expect(edit.range.start.line).toBe(0);
    expect(edit.range.end.line).toBe(1);
    expect(edit.range.end.character).toBe(5);
  });
});
