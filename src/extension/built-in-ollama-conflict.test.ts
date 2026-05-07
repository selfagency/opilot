import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { handleBuiltInOllamaConflict } from './built-in-ollama-conflict.js';

describe('built-in-ollama-conflict', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleBuiltInOllamaConflict', () => {
    it('does nothing when no built-in Ollama models exist', async () => {
      const selectChatModels = vi.fn().mockResolvedValue([]);
      const showWarningMessage = vi.fn();
      const getConfiguration = vi.fn();

      await handleBuiltInOllamaConflict(
        { showWarningMessage, showInformationMessage: vi.fn(), showErrorMessage: vi.fn() },
        { getConfiguration },
        { selectChatModels },
      );

      expect(showWarningMessage).not.toHaveBeenCalled();
    });

    it('shows warning prompt when built-in Ollama models exist', async () => {
      const showWarningMessage = vi.fn().mockResolvedValue('Disable Built-in Ollama Provider');
      const getConfiguration = vi.fn();
      const selectChatModels = vi.fn().mockResolvedValue([{ id: 'ollama:llama3', vendor: 'ollama', name: 'Llama 3' }]);

      await handleBuiltInOllamaConflict(
        { showWarningMessage, showInformationMessage: vi.fn(), showErrorMessage: vi.fn() },
        { getConfiguration },
        { selectChatModels },
      );

      expect(showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('built-in Ollama provider'),
        'Disable Built-in Ollama Provider',
      );
    });

    it('does nothing when user dismisses the warning', async () => {
      const showWarningMessage = vi.fn().mockResolvedValue(undefined);
      const showInformationMessage = vi.fn();
      const mockConfig = { update: vi.fn() };
      const getConfiguration = vi.fn().mockReturnValue(mockConfig);
      const selectChatModels = vi.fn().mockResolvedValue([{ id: 'ollama:llama3', vendor: 'ollama', name: 'Llama 3' }]);

      await handleBuiltInOllamaConflict(
        { showWarningMessage, showInformationMessage, showErrorMessage: vi.fn() },
        { getConfiguration },
        { selectChatModels },
      );

      expect(mockConfig.update).not.toHaveBeenCalled();
      expect(showInformationMessage).not.toHaveBeenCalled();
    });

    it('disables built-in provider and prompts for reload when user accepts', async () => {
      const showWarningMessage = vi.fn().mockResolvedValue('Disable Built-in Ollama Provider');
      const showInformationMessage = vi.fn().mockResolvedValue('Reload Window');
      const executeCommand = vi.fn().mockResolvedValue(undefined);
      const mockConfig = { update: vi.fn().mockResolvedValue(undefined) };
      const getConfiguration = vi.fn().mockReturnValue(mockConfig);
      const selectChatModels = vi.fn().mockResolvedValue([{ id: 'ollama:llama3', vendor: 'ollama', name: 'Llama 3' }]);

      await handleBuiltInOllamaConflict(
        { showWarningMessage, showInformationMessage, showErrorMessage: vi.fn() },
        { getConfiguration },
        { selectChatModels },
        { executeCommand },
      );

      expect(mockConfig.update).toHaveBeenCalledWith('ollama.url', '', vscode.ConfigurationTarget.Global);
      expect(showInformationMessage).toHaveBeenCalledWith(expect.stringContaining('disabled'), 'Reload Window');
      expect(executeCommand).toHaveBeenCalledWith('workbench.action.reloadWindow');
    });

    it('prevents concurrent conflict handling', async () => {
      const showWarningMessage = vi.fn().mockImplementation(async () => {
        // Simulate slow user interaction
        await new Promise(resolve => setTimeout(resolve, 100));
        return 'Disable Built-in Ollama Provider';
      });
      const showInformationMessage = vi.fn().mockResolvedValue('Reload Window');
      const executeCommand = vi.fn().mockResolvedValue(undefined);
      const mockConfig = { update: vi.fn().mockResolvedValue(undefined) };
      const getConfiguration = vi.fn().mockReturnValue(mockConfig);
      const selectChatModels = vi.fn().mockResolvedValue([{ id: 'ollama:llama3', vendor: 'ollama', name: 'Llama 3' }]);

      // Start two concurrent conflict checks
      const promise1 = handleBuiltInOllamaConflict(
        { showWarningMessage, showInformationMessage, showErrorMessage: vi.fn() },
        { getConfiguration },
        { selectChatModels },
        { executeCommand },
      );
      const promise2 = handleBuiltInOllamaConflict(
        { showWarningMessage, showInformationMessage, showErrorMessage: vi.fn() },
        { getConfiguration },
        { selectChatModels },
        { executeCommand },
      );

      await Promise.all([promise1, promise2]);

      // Should only update once despite concurrent calls
      expect(mockConfig.update).toHaveBeenCalledTimes(1);
    });
  });

  // Additional test cases to implement:
  // - test disableBuiltInOllamaProvider with config fallback
  // - test removeBuiltInOllamaFromChatLanguageModels file mutation
  // - test tryUpdateChatLanguageModelsFile retry logic
  // - test hasBuiltInOllamaModels detection
  // - test promptDisableBuiltInProvider user interaction
  // - test promptReloadAfterDisable reload command
});
