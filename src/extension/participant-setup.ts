/**
 * Chat participant setup and registration
 * Handles the creation and registration of the chat participant for the extension
 */

import * as vscode from 'vscode';
import { type ChatClient } from '../client.js';
import { type DiagnosticsLogger } from '../diagnostics.js';
import { type ModelSettingsStore } from '../modelSettings.js';
import { type ChatRequestHandler } from './lm-api.js';

import { getHelpTextPrefix, createTitleProvider, createSummarizer, getAdditionalWelcomeMessage } from '../participantFeatures';

/**
 * Setup context for chat participant registration
 */
export type ParticipantSetupContext = {
  context: vscode.ExtensionContext;
  handler: ChatRequestHandler;
  diagnostics: DiagnosticsLogger;
  client: ChatClient;
  modelSettingsStore: ModelSettingsStore;
};

/**
 * Creates and registers the chat participant
 * @param context Extension context
 * @param handler Chat request handler function
 * @param chatParticipantDetectionProvider Optional chat participant detection provider
 * @param client Ollama client
 * @param diagnostics Diagnostics logger
 * @returns Promise that resolves to the chat participant disposable
 */
export async function setupChatParticipant(
  context: vscode.ExtensionContext,
  handler: ChatRequestHandler,
  chatParticipantDetectionProvider?: vscode.Disposable,
  client?: ChatClient,
  diagnostics?: DiagnosticsLogger,
): Promise<vscode.Disposable> {
  const participantDetectionProvider = createParticipantDetectionProvider();
  const participantVariableProvider = createParticipantVariableProvider();
  const titleProvider = createTitleProvider();
  const followupProvider = createFollowupProvider();
  const summarizer = createSummarizer();

  const additionalWelcomeMessage = getAdditionalWelcomeMessage();
  const helpTextPrefix = getHelpTextPrefix();

  const participant = vscode.chat.createChatParticipant('opilot', {
    name: 'Opilot',
    shortName: 'opilot',
    description: 'Chat with your Ollama models',
    fullName: 'Opilot',
    isSticky: true,
    iconPath: vscode.Uri.joinPath(context.extensionUri, 'assets', 'opilot-icon.svg'),
    // eslint-disable-next-line @typescript-eslint/require-await
    async prompt(context) {
      const prompt = context.prompt;
      const resolvedPrompt = await resolvePromptReferences(prompt);
      return resolvedPrompt;
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async welcome() {
      return new vscode.ChatResponsePartialPart({
        message: new vscode.ChatResponseMarkdownPart(additionalWelcomeMessage + '\n\n' + helpTextPrefix),
      });
    },
  });

  participant.onDidReceiveMessage(async (message: vscode.ChatMessage) => {
    if (message.command === 'refresh-models') {
      if (client && diagnostics) {
        try {
          await client.ps();
          diagnostics.info('[chat-participant] models refreshed via chat command');
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          diagnostics.error(`[chat-participant] failed to refresh models: ${msg}`);
        }
      }
    }
  });

  const subscriptions: vscode.Disposable[] = [
    participant,
    participantDetectionProvider,
    participantVariableProvider,
    titleProvider,
    followupProvider,
    summarizer,
  ];

  if (chatParticipantDetectionProvider) {
    subscriptions.push(chatParticipantDetectionProvider);
  }

  context.subscriptions.push(...subscriptions);

  return {
    dispose: () => {
      for (const sub of subscriptions) {
        sub.dispose();
      }
    },
  };
}

// Re-export participant features for convenience
import {
  createFollowupProvider,
  createParticipantDetectionProvider,
  createParticipantVariableProvider,
  createSummarizer,
  createTitleProvider,
  getAdditionalWelcomeMessage,
  getHelpTextPrefix,
  resolvePromptReferences,
} from '../participantFeatures.js';

export {
  createFollowupProvider,
  createParticipantDetectionProvider,
  createParticipantVariableProvider,
  createSummarizer,
  createTitleProvider,
  getAdditionalWelcomeMessage,
  getHelpTextPrefix,
  resolvePromptReferences,
};
