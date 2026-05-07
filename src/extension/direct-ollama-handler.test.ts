/**
 * Tests for direct Ollama handler module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as vscode from 'vscode';
import { handleDirectOllamaRequest, handleXmlToolFallback, streamModelResponse } from './direct-ollama-handler.js';

describe('direct-ollama-handler', () => {
  let mockRequest: vscode.ChatRequest;
  let mockChatContext: vscode.ChatContext;
  let mockStream: vscode.ChatResponseStream;
  let mockToken: vscode.CancellationToken;
  let mockClient: any;
  let mockDiagnostics: any;
  let mockExtensionContext: any;

  beforeEach(() => {
    vi.resetAllMocks();

    mockRequest = {
      prompt: 'Test prompt',
      model: {
        id: 'ollama:llama3',
      },
      toolInvocationToken: 'test-token',
    } as unknown as vscode.ChatRequest;

    mockChatContext = {
      history: [],
    } as unknown as vscode.ChatContext;

    mockStream = {
      markdown: vi.fn(),
      text: vi.fn(),
      button: vi.fn(),
      file: vi.fn(),
      reference: vi.fn(),
    };

    mockToken = {
      isCancellationRequested: false,
      onCancellationRequested: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    };

    mockClient = {
      chat: vi.fn().mockResolvedValue({
        message: { content: 'Test response' },
      }),
    };

    mockDiagnostics = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    mockExtensionContext = {
      extensionUri: vscode.Uri.file('/tmp/extension'),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should handle direct Ollama request', async () => {
    const mockHandleDirectOllamaRequest = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(vscode, 'workspace').mockReturnValue({
      getConfiguration: vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue([]),
      }),
    } as any);

    await handleDirectOllamaRequest(mockRequest, [], {
      stream: mockStream,
      token: mockToken,
      client: mockClient,
      outputChannel: mockDiagnostics,
      extensionContext: mockExtensionContext,
      modelSettings: {},
    });

    expect(mockHandleDirectOllamaRequest).toHaveBeenCalled();
  });

  it('should handle XML tool fallback', async () => {
    const mockExtractXmlToolCalls = vi.fn().mockReturnValue([
      {
        name: 'test-tool',
        arguments: { test: 'value' },
        toolCallId: 'call-1',
      },
    ]);

    vi.spyOn(vscode, 'workspace').mockReturnValue({
      getConfiguration: vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue([]),
      }),
    } as any);

    const result = await handleXmlToolFallback({
      modelId: 'llama3',
      isCloudModel: false,
      ollamaMessages: [{ role: 'user', content: 'test' }],
      vscodeLmTools: [{ name: 'test-tool', description: 'Test tool' }],
      request: mockRequest,
      stream: mockStream,
      token: mockToken,
      effectiveClient: mockClient,
      baseUrl: 'http://localhost:11434',
      authToken: 'test-token',
      modelOptions: {},
      logOpenAiCompatFallback: vi.fn(),
      outputChannel: mockDiagnostics,
    });

    expect(result).toBeDefined();
  });

  it('should stream model response', async () => {
    const mockNativeSdkStreamChat = vi.fn().mockResolvedValue({
      stream: {
        [Symbol.asyncIterator]: vi.fn().mockReturnValue({
          next: vi.fn().mockResolvedValue({ value: {}, done: false }),
        }),
      },
    });

    vi.spyOn(vscode, 'workspace').mockReturnValue({
      getConfiguration: vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue([]),
      }),
    } as any);

    await streamModelResponse({
      modelId: 'llama3',
      isCloudModel: false,
      ollamaMessages: [{ role: 'user', content: 'test' }],
      systemContextParts: [],
      vscodeLmTools: [],
      request: mockRequest,
      stream: mockStream,
      token: mockToken,
      effectiveClient: mockClient,
      baseUrl: 'http://localhost:11434',
      authToken: 'test-token',
      modelOptions: {},
      logOpenAiCompatFallback: vi.fn(),
      outputChannel: mockDiagnostics,
    });

    expect(mockNativeSdkStreamChat).toHaveBeenCalled();
  });

  it('should handle cancellation during XML fallback', async () => {
    mockToken.isCancellationRequested = true;

    const result = await handleXmlToolFallback({
      modelId: 'llama3',
      isCloudModel: false,
      ollamaMessages: [{ role: 'user', content: 'test' }],
      vscodeLmTools: [{ name: 'test-tool', description: 'Test tool' }],
      request: mockRequest,
      stream: mockStream,
      token: mockToken,
      effectiveClient: mockClient,
      baseUrl: 'http://localhost:11434',
      authToken: 'test-token',
      modelOptions: {},
      logOpenAiCompatFallback: vi.fn(),
      outputChannel: mockDiagnostics,
    });

    expect(result).toBe(true);
  });

  it('should handle cancellation during streaming', async () => {
    mockToken.isCancellationRequested = true;

    await streamModelResponse({
      modelId: 'llama3',
      isCloudModel: false,
      ollamaMessages: [{ role: 'user', content: 'test' }],
      systemContextParts: [],
      vscodeLmTools: [],
      request: mockRequest,
      stream: mockStream,
      token: mockToken,
      effectiveClient: mockClient,
      baseUrl: 'http://localhost:11434',
      authToken: 'test-token',
      modelOptions: {},
      logOpenAiCompatFallback: vi.fn(),
      outputChannel: mockDiagnostics,
    });

    expect(mockDiagnostics.info).toHaveBeenCalledWith(expect.stringContaining('cancellation'));
  });
});