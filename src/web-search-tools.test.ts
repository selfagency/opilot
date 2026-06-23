import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

// Mock vscode before importing the module under test
vi.mock('vscode', () => ({
  lm: {
    registerTool: vi.fn(() => ({ dispose: vi.fn() }))
  },
  LanguageModelToolResult: class {
    content: unknown[];
    constructor(content: unknown[]) {
      this.content = content;
    }
  },
  LanguageModelTextPart: class {
    value: string;
    constructor(value: string) {
      this.value = value;
    }
  }
}));

// Mock settings so the feature gate returns true
vi.mock('./settings.js', () => ({
  getSetting: vi.fn((key: string, defaultValue: boolean) => {
    if (key === 'experimental.webSearch') {
      return true;
    }
    return defaultValue;
  })
}));

import { OllamaWebFetchTool, OllamaWebSearchTool, registerOllamaWebTools } from './web-search-tools.js';

function makeMockClient() {
  return {
    webSearch: vi.fn(),
    webFetch: vi.fn()
  } as never;
}

describe('OllamaWebSearchTool', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws on empty query', async () => {
    const client = makeMockClient();
    const tool = new OllamaWebSearchTool(client);

    await expect(tool.invoke({ input: { query: '' } } as never, {} as never)).rejects.toThrow(
      'Search query is required.'
    );
  });

  it('throws on whitespace-only query', async () => {
    const client = makeMockClient();
    const tool = new OllamaWebSearchTool(client);

    await expect(tool.invoke({ input: { query: '   ' } } as never, {} as never)).rejects.toThrow(
      'Search query is required.'
    );
  });

  it('returns formatted search results on success', async () => {
    const mockResult = { results: [{ title: 'Test', url: 'https://example.com', content: 'Test content' }] };
    const client = makeMockClient();
    (client as any).webSearch.mockResolvedValue(mockResult);
    const tool = new OllamaWebSearchTool(client);

    const result = await tool.invoke({ input: { query: 'test query', max_results: 3 } } as never, {} as never);

    expect((client as any).webSearch).toHaveBeenCalledWith('test query', { max_results: 3 });
    expect(result.content[0]).toBeInstanceOf(vscode.LanguageModelTextPart);
    const textPart = result.content[0] as vscode.LanguageModelTextPart;
    expect(textPart.value).toContain('Test');
    expect(textPart.value).toContain('https://example.com');
  });

  it('re-throws SDK errors with helpful message', async () => {
    const client = makeMockClient();
    (client as any).webSearch.mockRejectedValue(new Error('network error'));
    const tool = new OllamaWebSearchTool(client);

    await expect(tool.invoke({ input: { query: 'test' } } as never, {} as never)).rejects.toThrow(
      /failed: network error/
    );
  });

  it('includes API key hint on auth errors', async () => {
    const client = makeMockClient();
    (client as any).webSearch.mockRejectedValue(new Error('unauthorized'));
    const tool = new OllamaWebSearchTool(client);

    await expect(tool.invoke({ input: { query: 'test' } } as never, {} as never)).rejects.toThrow(/API key/);
  });
});

describe('OllamaWebFetchTool', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws on empty URL', async () => {
    const client = makeMockClient();
    const tool = new OllamaWebFetchTool(client);

    await expect(tool.invoke({ input: { url: '' } } as never, {} as never)).rejects.toThrow('URL is required.');
  });

  it('returns formatted fetch result on success', async () => {
    const mockResult = {
      title: 'Example',
      content: 'Page content here',
      links: ['https://example.com'],
      url: 'https://example.com'
    };
    const client = makeMockClient();
    (client as any).webFetch.mockResolvedValue(mockResult);
    const tool = new OllamaWebFetchTool(client);

    const result = await tool.invoke({ input: { url: 'https://example.com' } } as never, {} as never);

    expect((client as any).webFetch).toHaveBeenCalledWith('https://example.com');
    expect(result.content[0]).toBeInstanceOf(vscode.LanguageModelTextPart);
    const textPart = result.content[0] as vscode.LanguageModelTextPart;
    expect(textPart.value).toContain('Example');
    expect(textPart.value).toContain('Page content here');
  });

  it('re-throws SDK errors with helpful message', async () => {
    const client = makeMockClient();
    (client as any).webFetch.mockRejectedValue(new Error('network error'));
    const tool = new OllamaWebFetchTool(client);

    await expect(tool.invoke({ input: { url: 'https://example.com' } } as never, {} as never)).rejects.toThrow(
      /failed: network error/
    );
  });

  it('includes API key hint on auth errors for webFetch', async () => {
    const client = makeMockClient();
    (client as any).webFetch.mockRejectedValue(new Error('403 Forbidden'));
    const tool = new OllamaWebFetchTool(client);

    await expect(tool.invoke({ input: { url: 'https://example.com' } } as never, {} as never)).rejects.toThrow(
      /API key/
    );
  });
});

describe('registerOllamaWebTools', () => {
  it('registers both tools in extension context', () => {
    const subscriptions: { dispose: () => void }[] = [];
    const context = { subscriptions } as never;
    registerOllamaWebTools(context, makeMockClient());

    expect(vscode.lm.registerTool).toHaveBeenCalledTimes(2);
    expect(vscode.lm.registerTool).toHaveBeenCalledWith('ollama_webSearch', expect.any(OllamaWebSearchTool));
    expect(vscode.lm.registerTool).toHaveBeenCalledWith('ollama_webFetch', expect.any(OllamaWebFetchTool));
  });
});
