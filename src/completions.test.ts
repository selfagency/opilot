import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('OllamaInlineCompletionProvider', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function makeToken(isCancellationRequested = false) {
    return { isCancellationRequested };
  }

  function makeDocument(text: string, offset: number) {
    const positionAt = (off: number) => ({ _off: Math.min(Math.max(0, off), text.length) });
    return {
      getText: (range?: unknown) => {
        if (!range) return text;
        const r = range as { start: { _off?: number }; end: { _off?: number } };
        // When `position` (passed as `{}`) is used as a range boundary it has no
        // `_off`, so fall back to the cursor offset so slicing stays correct.
        const start = r.start._off ?? offset;
        const end = r.end._off ?? offset;
        return text.slice(start, end);
      },
      offsetAt: (pos: unknown) => {
        if (typeof pos === 'object' && pos !== null) {
          if ('_off' in (pos as object)) return (pos as { _off: number })._off;
          // Sentinel: vscode.Position(lineCount - 1, MAX_SAFE_INTEGER) → document end
          if ('character' in (pos as object) && (pos as { character: number }).character === Number.MAX_SAFE_INTEGER)
            return text.length;
        }
        return offset;
      },
      positionAt,
      lineCount: text.split('\n').length || 1,
    };
  }

  function makeConfigGet(enableInlineCompletions: boolean, completionModel: string) {
    return vi.fn((key: string) => {
      if (key === 'enableInlineCompletions') return enableInlineCompletions;
      if (key === 'completionModel') return completionModel;
      return undefined;
    });
  }

  it('returns null when enableInlineCompletions is false', async () => {
    vi.doMock('vscode', () => ({
      workspace: {
        getConfiguration: vi.fn(() => ({
          get: makeConfigGet(false, 'llama3.2'),
        })),
      },
      Position: class {
        constructor(
          public readonly line: number,
          public readonly character: number,
        ) {}
      },
      Range: class {
        constructor(
          public readonly start: unknown,
          public readonly end: unknown,
        ) {}
      },
      InlineCompletionItem: class {
        constructor(public readonly insertText: string) {}
      },
    }));

    const { OllamaInlineCompletionProvider } = await import('./completions.js');
    const client = { generate: vi.fn() } as any;
    const provider = new OllamaInlineCompletionProvider(client);
    const result = await provider.provideInlineCompletionItems(
      makeDocument('hello', 5) as any,
      {} as any,
      {} as any,
      makeToken() as any,
    );

    expect(result).toBeNull();
    expect(client.generate).not.toHaveBeenCalled();
  });

  it('returns null when completionModel is empty string', async () => {
    vi.doMock('vscode', () => ({
      workspace: {
        getConfiguration: vi.fn(() => ({
          get: makeConfigGet(true, ''),
        })),
      },
      Position: class {
        constructor(
          public readonly line: number,
          public readonly character: number,
        ) {}
      },
      Range: class {
        constructor(
          public readonly start: unknown,
          public readonly end: unknown,
        ) {}
      },
      InlineCompletionItem: class {
        constructor(public readonly insertText: string) {}
      },
    }));

    const { OllamaInlineCompletionProvider } = await import('./completions.js');
    const client = { generate: vi.fn() } as any;
    const provider = new OllamaInlineCompletionProvider(client);
    const result = await provider.provideInlineCompletionItems(
      makeDocument('hello', 5) as any,
      {} as any,
      {} as any,
      makeToken() as any,
    );

    expect(result).toBeNull();
    expect(client.generate).not.toHaveBeenCalled();
  });

  it('returns null when completionModel is whitespace', async () => {
    vi.doMock('vscode', () => ({
      workspace: {
        getConfiguration: vi.fn(() => ({
          get: makeConfigGet(true, '   '),
        })),
      },
      Position: class {
        constructor(
          public readonly line: number,
          public readonly character: number,
        ) {}
      },
      Range: class {
        constructor(
          public readonly start: unknown,
          public readonly end: unknown,
        ) {}
      },
      InlineCompletionItem: class {
        constructor(public readonly insertText: string) {}
      },
    }));

    const { OllamaInlineCompletionProvider } = await import('./completions.js');
    const client = { generate: vi.fn() } as any;
    const provider = new OllamaInlineCompletionProvider(client);
    const result = await provider.provideInlineCompletionItems(
      makeDocument('hello', 5) as any,
      {} as any,
      {} as any,
      makeToken() as any,
    );

    expect(result).toBeNull();
    expect(client.generate).not.toHaveBeenCalled();
  });

  it('calls client.generate with correct prefix and suffix', async () => {
    const generateMock = vi.fn().mockResolvedValue({ response: 'const x = 1;' });

    vi.doMock('vscode', () => ({
      workspace: {
        getConfiguration: vi.fn(() => ({
          get: makeConfigGet(true, 'qwen2.5-coder:1.5b'),
        })),
      },
      Position: class {
        constructor(
          public readonly line: number,
          public readonly character: number,
        ) {}
      },
      Range: class {
        constructor(
          public readonly start: unknown,
          public readonly end: unknown,
        ) {}
      },
      InlineCompletionItem: class {
        constructor(public readonly insertText: string) {}
      },
    }));

    const { OllamaInlineCompletionProvider } = await import('./completions.js');
    const client = { generate: generateMock } as any;
    const provider = new OllamaInlineCompletionProvider(client);

    const text = 'hello world';
    const offset = 5; // cursor after 'hello'
    await provider.provideInlineCompletionItems(
      makeDocument(text, offset) as any,
      {} as any,
      {} as any,
      makeToken() as any,
    );

    expect(generateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'qwen2.5-coder:1.5b',
        prompt: 'hello',
        suffix: ' world',
        stream: false,
      }),
    );
  });

  it('returns InlineCompletionItem wrapping the response text', async () => {
    const completionText = 'const x = 1;';
    vi.doMock('vscode', () => ({
      workspace: {
        getConfiguration: vi.fn(() => ({
          get: makeConfigGet(true, 'qwen2.5-coder:1.5b'),
        })),
      },
      Position: class {
        constructor(
          public readonly line: number,
          public readonly character: number,
        ) {}
      },
      Range: class {
        constructor(
          public readonly start: unknown,
          public readonly end: unknown,
        ) {}
      },
      InlineCompletionItem: class {
        constructor(public readonly insertText: string) {}
      },
    }));

    const { OllamaInlineCompletionProvider } = await import('./completions.js');
    const client = { generate: vi.fn().mockResolvedValue({ response: completionText }) } as any;
    const provider = new OllamaInlineCompletionProvider(client);

    const result = await provider.provideInlineCompletionItems(
      makeDocument('hello', 5) as any,
      {} as any,
      {} as any,
      makeToken() as any,
    );

    expect(result).toHaveLength(1);
    expect((result as any[])[0].insertText).toBe(completionText);
  });

  it('returns null for empty response', async () => {
    vi.doMock('vscode', () => ({
      workspace: {
        getConfiguration: vi.fn(() => ({
          get: makeConfigGet(true, 'qwen2.5-coder:1.5b'),
        })),
      },
      Position: class {
        constructor(
          public readonly line: number,
          public readonly character: number,
        ) {}
      },
      Range: class {
        constructor(
          public readonly start: unknown,
          public readonly end: unknown,
        ) {}
      },
      InlineCompletionItem: class {
        constructor(public readonly insertText: string) {}
      },
    }));

    const { OllamaInlineCompletionProvider } = await import('./completions.js');
    const client = { generate: vi.fn().mockResolvedValue({ response: '' }) } as any;
    const provider = new OllamaInlineCompletionProvider(client);

    const result = await provider.provideInlineCompletionItems(
      makeDocument('hello', 5) as any,
      {} as any,
      {} as any,
      makeToken() as any,
    );

    expect(result).toBeNull();
  });

  it('returns null for whitespace-only response', async () => {
    vi.doMock('vscode', () => ({
      workspace: {
        getConfiguration: vi.fn(() => ({
          get: makeConfigGet(true, 'qwen2.5-coder:1.5b'),
        })),
      },
      Position: class {
        constructor(
          public readonly line: number,
          public readonly character: number,
        ) {}
      },
      Range: class {
        constructor(
          public readonly start: unknown,
          public readonly end: unknown,
        ) {}
      },
      InlineCompletionItem: class {
        constructor(public readonly insertText: string) {}
      },
    }));

    const { OllamaInlineCompletionProvider } = await import('./completions.js');
    const client = { generate: vi.fn().mockResolvedValue({ response: '   \n  ' }) } as any;
    const provider = new OllamaInlineCompletionProvider(client);

    const result = await provider.provideInlineCompletionItems(
      makeDocument('hello', 5) as any,
      {} as any,
      {} as any,
      makeToken() as any,
    );

    expect(result).toBeNull();
  });

  it('returns null when cancellation is requested on entry', async () => {
    vi.doMock('vscode', () => ({
      workspace: {
        getConfiguration: vi.fn(() => ({
          get: makeConfigGet(true, 'qwen2.5-coder:1.5b'),
        })),
      },
      Position: class {
        constructor(
          public readonly line: number,
          public readonly character: number,
        ) {}
      },
      Range: class {
        constructor(
          public readonly start: unknown,
          public readonly end: unknown,
        ) {}
      },
      InlineCompletionItem: class {
        constructor(public readonly insertText: string) {}
      },
    }));

    const { OllamaInlineCompletionProvider } = await import('./completions.js');
    const client = { generate: vi.fn() } as any;
    const provider = new OllamaInlineCompletionProvider(client);

    const result = await provider.provideInlineCompletionItems(
      makeDocument('hello', 5) as any,
      {} as any,
      {} as any,
      makeToken(true) as any,
    );

    expect(result).toBeNull();
    expect(client.generate).not.toHaveBeenCalled();
  });

  it('returns null when cancellation is requested after generate resolves', async () => {
    const token = { isCancellationRequested: false };

    vi.doMock('vscode', () => ({
      workspace: {
        getConfiguration: vi.fn(() => ({
          get: makeConfigGet(true, 'qwen2.5-coder:1.5b'),
        })),
      },
      Position: class {
        constructor(
          public readonly line: number,
          public readonly character: number,
        ) {}
      },
      Range: class {
        constructor(
          public readonly start: unknown,
          public readonly end: unknown,
        ) {}
      },
      InlineCompletionItem: class {
        constructor(public readonly insertText: string) {}
      },
    }));

    const { OllamaInlineCompletionProvider } = await import('./completions.js');
    const client = {
      generate: vi.fn().mockImplementation(async () => {
        token.isCancellationRequested = true;
        return { response: 'const x = 1;' };
      }),
    } as any;
    const provider = new OllamaInlineCompletionProvider(client);

    const result = await provider.provideInlineCompletionItems(
      makeDocument('hello', 5) as any,
      {} as any,
      {} as any,
      token as any,
    );

    expect(result).toBeNull();
  });

  it('trims prefix to MAX_COMPLETION_PREFIX_CHARS', async () => {
    const generateMock = vi.fn().mockResolvedValue({ response: 'x' });

    vi.doMock('vscode', () => ({
      workspace: {
        getConfiguration: vi.fn(() => ({
          get: makeConfigGet(true, 'qwen2.5-coder:1.5b'),
        })),
      },
      Position: class {
        constructor(
          public readonly line: number,
          public readonly character: number,
        ) {}
      },
      Range: class {
        constructor(
          public readonly start: unknown,
          public readonly end: unknown,
        ) {}
      },
      InlineCompletionItem: class {
        constructor(public readonly insertText: string) {}
      },
    }));

    const { OllamaInlineCompletionProvider, MAX_COMPLETION_PREFIX_CHARS } = await import('./completions.js');
    const client = { generate: generateMock } as any;
    const provider = new OllamaInlineCompletionProvider(client);

    const longPrefix = 'a'.repeat(MAX_COMPLETION_PREFIX_CHARS + 100);
    const suffix = 'end';
    const text = longPrefix + suffix;
    const offset = longPrefix.length;

    await provider.provideInlineCompletionItems(
      makeDocument(text, offset) as any,
      {} as any,
      {} as any,
      makeToken() as any,
    );

    const call = generateMock.mock.calls[0][0];
    expect(call.prompt).toHaveLength(MAX_COMPLETION_PREFIX_CHARS);
    expect(call.prompt).toBe('a'.repeat(MAX_COMPLETION_PREFIX_CHARS));
  });

  it('trims suffix to MAX_COMPLETION_SUFFIX_CHARS', async () => {
    const generateMock = vi.fn().mockResolvedValue({ response: 'x' });

    vi.doMock('vscode', () => ({
      workspace: {
        getConfiguration: vi.fn(() => ({
          get: makeConfigGet(true, 'qwen2.5-coder:1.5b'),
        })),
      },
      Position: class {
        constructor(
          public readonly line: number,
          public readonly character: number,
        ) {}
      },
      Range: class {
        constructor(
          public readonly start: unknown,
          public readonly end: unknown,
        ) {}
      },
      InlineCompletionItem: class {
        constructor(public readonly insertText: string) {}
      },
    }));

    const { OllamaInlineCompletionProvider, MAX_COMPLETION_SUFFIX_CHARS } = await import('./completions.js');
    const client = { generate: generateMock } as any;
    const provider = new OllamaInlineCompletionProvider(client);

    const prefix = 'start';
    const longSuffix = 'b'.repeat(MAX_COMPLETION_SUFFIX_CHARS + 100);
    const text = prefix + longSuffix;
    const offset = prefix.length;

    await provider.provideInlineCompletionItems(
      makeDocument(text, offset) as any,
      {} as any,
      {} as any,
      makeToken() as any,
    );

    const call = generateMock.mock.calls[0][0];
    expect(call.suffix).toHaveLength(MAX_COMPLETION_SUFFIX_CHARS);
    expect(call.suffix).toBe('b'.repeat(MAX_COMPLETION_SUFFIX_CHARS));
  });

  it('omits suffix field when suffix is empty', async () => {
    const generateMock = vi.fn().mockResolvedValue({ response: 'x' });

    vi.doMock('vscode', () => ({
      workspace: {
        getConfiguration: vi.fn(() => ({
          get: makeConfigGet(true, 'qwen2.5-coder:1.5b'),
        })),
      },
      Position: class {
        constructor(
          public readonly line: number,
          public readonly character: number,
        ) {}
      },
      Range: class {
        constructor(
          public readonly start: unknown,
          public readonly end: unknown,
        ) {}
      },
      InlineCompletionItem: class {
        constructor(public readonly insertText: string) {}
      },
    }));

    const { OllamaInlineCompletionProvider } = await import('./completions.js');
    const client = { generate: generateMock } as any;
    const provider = new OllamaInlineCompletionProvider(client);

    const text = 'hello';
    const offset = text.length; // cursor at end, no suffix

    await provider.provideInlineCompletionItems(
      makeDocument(text, offset) as any,
      {} as any,
      {} as any,
      makeToken() as any,
    );

    const call = generateMock.mock.calls[0][0];
    expect(call.suffix).toBeUndefined();
  });

  it('catches generate errors and returns null', async () => {
    const logChannel = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };

    vi.doMock('vscode', () => ({
      workspace: {
        getConfiguration: vi.fn(() => ({
          get: makeConfigGet(true, 'qwen2.5-coder:1.5b'),
        })),
      },
      Position: class {
        constructor(
          public readonly line: number,
          public readonly character: number,
        ) {}
      },
      Range: class {
        constructor(
          public readonly start: unknown,
          public readonly end: unknown,
        ) {}
      },
      InlineCompletionItem: class {
        constructor(public readonly insertText: string) {}
      },
    }));

    const { OllamaInlineCompletionProvider } = await import('./completions.js');
    const client = { generate: vi.fn().mockRejectedValue(new Error('Connection refused')) } as any;
    const provider = new OllamaInlineCompletionProvider(client, logChannel as any);

    const result = await provider.provideInlineCompletionItems(
      makeDocument('hello', 5) as any,
      {} as any,
      {} as any,
      makeToken() as any,
    );

    expect(result).toBeNull();
    expect(logChannel.error).toHaveBeenCalledWith(expect.stringContaining('Connection refused'));
  });

  it('does not call logChannel.error when no logChannel provided', async () => {
    vi.doMock('vscode', () => ({
      workspace: {
        getConfiguration: vi.fn(() => ({
          get: makeConfigGet(true, 'qwen2.5-coder:1.5b'),
        })),
      },
      Position: class {
        constructor(
          public readonly line: number,
          public readonly character: number,
        ) {}
      },
      Range: class {
        constructor(
          public readonly start: unknown,
          public readonly end: unknown,
        ) {}
      },
      InlineCompletionItem: class {
        constructor(public readonly insertText: string) {}
      },
    }));

    const { OllamaInlineCompletionProvider } = await import('./completions.js');
    const client = { generate: vi.fn().mockRejectedValue(new Error('oops')) } as any;
    const provider = new OllamaInlineCompletionProvider(client);

    await expect(
      provider.provideInlineCompletionItems(makeDocument('hello', 5) as any, {} as any, {} as any, makeToken() as any),
    ).resolves.toBeNull();
  });
});
