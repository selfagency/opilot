/**
 * Tests for participant setup module
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { setupChatParticipant } from './participant-setup.js';

describe('participant-setup', () => {
  let mockContext: vscode.ExtensionContext;
  let mockHandler: any;
  let mockDiagnostics: any;
  let mockClient: any;

  beforeEach(() => {
    vi.resetAllMocks();

    mockContext = {
      extensionUri: vscode.Uri.file('/tmp/extension'),
      subscriptions: [],
    } as unknown as vscode.ExtensionContext;

    mockHandler = vi.fn();
    mockDiagnostics = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    mockClient = {
      ps: vi.fn().mockResolvedValue({ models: [] }),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should create and register chat participant', async () => {
    const mockCreateChatParticipant = vi.fn().mockReturnValue({
      onDidReceiveMessage: vi.fn(),
    });

    vi.spyOn(vscode.chat, 'createChatParticipant').mockImplementation(mockCreateChatParticipant);
    vi.spyOn(vscode.Uri, 'joinPath').mockReturnValue(vscode.Uri.file('/tmp/icon.svg'));

    const participant = await setupChatParticipant(mockContext, mockHandler, undefined, mockClient, mockDiagnostics);

    expect(vscode.chat.createChatParticipant).toHaveBeenCalledWith('opilot', expect.any(Object));
    expect(participant).toHaveProperty('dispose');
    expect(typeof participant.dispose).toBe('function');
  });

  it('should handle refresh-models command', async () => {
    const mockCreateChatParticipant = vi.fn().mockReturnValue({
      onDidReceiveMessage: vi.fn().mockImplementation(fn => {
        fn({ command: 'refresh-models' });
      }),
    });

    vi.spyOn(vscode.chat, 'createChatParticipant').mockImplementation(mockCreateChatParticipant);
    vi.spyOn(vscode.Uri, 'joinPath').mockReturnValue(vscode.Uri.file('/tmp/icon.svg'));

    await setupChatParticipant(mockContext, mockHandler, undefined, mockClient, mockDiagnostics);

    expect(mockClient.ps).toHaveBeenCalled();
    expect(mockDiagnostics.info).toHaveBeenCalledWith(expect.stringContaining('models refreshed'));
  });

  it('should handle errors during model refresh', async () => {
    const mockCreateChatParticipant = vi.fn().mockReturnValue({
      onDidReceiveMessage: vi.fn().mockImplementation(fn => {
        fn({ command: 'refresh-models' });
      }),
    });

    vi.spyOn(vscode.chat, 'createChatParticipant').mockImplementation(mockCreateChatParticipant);
    vi.spyOn(vscode.Uri, 'joinPath').mockReturnValue(vscode.Uri.file('/tmp/icon.svg'));

    mockClient.ps.mockRejectedValue(new Error('Failed to refresh models'));

    await setupChatParticipant(mockContext, mockHandler, undefined, mockClient, mockDiagnostics);

    expect(mockDiagnostics.error).toHaveBeenCalledWith(
      expect.stringContaining('failed to refresh models'),
      expect.any(Error),
    );
  });

  it('should dispose all subscriptions', async () => {
    const mockDispose = vi.fn();
    const mockCreateChatParticipant = vi.fn().mockReturnValue({
      onDidReceiveMessage: vi.fn(),
      dispose: mockDispose,
    });

    vi.spyOn(vscode.chat, 'createChatParticipant').mockImplementation(mockCreateChatParticipant);
    vi.spyOn(vscode.Uri, 'joinPath').mockReturnValue(vscode.Uri.file('/tmp/icon.svg'));

    const participant = await setupChatParticipant(mockContext, mockHandler, undefined, mockClient, mockDiagnostics);

    participant.dispose();

    expect(mockDispose).toHaveBeenCalled();
  });

  it('should not throw if client or diagnostics are undefined', async () => {
    const mockCreateChatParticipant = vi.fn().mockReturnValue({
      onDidReceiveMessage: vi.fn(),
    });

    vi.spyOn(vscode.chat, 'createChatParticipant').mockImplementation(mockCreateChatParticipant);
    vi.spyOn(vscode.Uri, 'joinPath').mockReturnValue(vscode.Uri.file('/tmp/icon.svg'));

    await expect(
      setupChatParticipant(mockContext, mockHandler, undefined, undefined, undefined),
    ).resolves.not.toThrow();
  });
});
