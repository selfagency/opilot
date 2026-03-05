/* eslint-disable jest/expect-expect */
'use strict';
const assert = require('assert');
const vscode = require('vscode');

suite('Extension Integration', () => {
  suiteSetup(async () => {
    // The activation event ('onLanguageModelChatProvider:mistral') doesn't fire
    // automatically in the test harness, so force-activate the extension.
    const ext = vscode.extensions.getExtension('selfagency.mistral-models-vscode');
    if (ext && !ext.isActive) {
      await ext.activate();
    }
  });

  test('manageApiKey command is registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('mistral-chat.manageApiKey'), 'mistral-chat.manageApiKey command not registered');
  });
});
