/* eslint-disable jest/expect-expect */
'use strict';
const assert = require('assert');
const vscode = require('vscode');

suite('Extension Integration', () => {
  suiteSetup(async () => {
    // The activation event ('onLanguageModelChatProvider:selfagency-ollama') doesn't fire
    // automatically in the test harness, so force-activate the extension.
    const ext = vscode.extensions.getExtension('selfagency.ollama-copilot');
    if (ext && !ext.isActive) {
      await ext.activate();
    }
  });

  test('manageAuthToken command is registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('ollama-copilot.manageAuthToken'), 'ollama-copilot.manageAuthToken command not registered');
  });
});
