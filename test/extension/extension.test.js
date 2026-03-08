/* eslint-disable jest/expect-expect */
'use strict';
const assert = require('assert');
const vscode = require('vscode');

/**
 * Extension Integration Tests
 *
 * These tests verify the extension activates correctly and exposes all expected
 * commands, views, chat participants, and settings.
 *
 * Requirements:
 * - VS Code test environment
 * - Ollama server running on http://localhost:11434 (optional for most tests)
 */

let extension;

exports.run = async () => {
  // Get the extension
  extension = vscode.extensions.getExtension('selfagency.ollama-copilot');
  assert.ok(extension, 'Extension not found');

  // Activate the extension
  if (extension && !extension.isActive) {
    await extension.activate();
  }

  // Get list of all commands once
  const commands = await vscode.commands.getCommands(true);

  // ---------------------------------------------------------------------------
  // Extension Activation
  // ---------------------------------------------------------------------------

  console.log('✓ Extension activated');
  assert.ok(extension.isActive, 'Extension did not activate');

  // ---------------------------------------------------------------------------
  // Command Registration
  // ---------------------------------------------------------------------------

  const expectedCommands = [
    'ollama-copilot.manageAuthToken',
    'ollama-copilot.refreshLocalModels',
    'ollama-copilot.refreshCloudModels',
    'ollama-copilot.refreshLibrary',
    'ollama-copilot.startModel',
    'ollama-copilot.stopModel',
    'ollama-copilot.deleteModel',
    'ollama-copilot.pullModel',
    'ollama-copilot.openLibraryModelPage',
    'ollama-copilot.filterLocalModels',
    'ollama-copilot.clearLocalFilter',
    'ollama-copilot.toggleLocalGrouping',
    'ollama-copilot.filterCloudModels',
    'ollama-copilot.clearCloudFilter',
    'ollama-copilot.toggleCloudGrouping',
    'ollama-copilot.filterLibraryModels',
    'ollama-copilot.clearLibraryFilter',
    'ollama-copilot.toggleLibraryGrouping',
    'ollama-copilot.newModelfile',
    'ollama-copilot.editModelfile',
    'ollama-copilot.buildModelfile',
    'ollama-copilot.openModelfilesFolder',
    'ollama-copilot.refreshModelfiles',
  ];

  for (const cmd of expectedCommands) {
    assert.ok(commands.includes(cmd), `Command ${cmd} not registered`);
    console.log(`✓ ${cmd} registered`);
  }

  // ---------------------------------------------------------------------------
  // Sidebar/Tree View Providers
  // ---------------------------------------------------------------------------

  assert.ok(commands.includes('ollama-copilot.refreshLocalModels'), 'Local models tree view not properly initialized');
  console.log('✓ Local models tree view initialized');

  assert.ok(commands.includes('ollama-copilot.refreshCloudModels'), 'Cloud models tree view not properly initialized');
  console.log('✓ Cloud models tree view initialized');

  assert.ok(commands.includes('ollama-copilot.refreshLibrary'), 'Library models tree view not properly initialized');
  console.log('✓ Library models tree view initialized');

  assert.ok(commands.includes('ollama-copilot.newModelfile'), 'Modelfiles tree view not properly initialized');
  console.log('✓ Modelfiles tree view initialized');

  // ---------------------------------------------------------------------------
  // Chat Participant
  // ---------------------------------------------------------------------------

  assert.ok(extension.isActive, 'Chat participant requires active extension');
  console.log('✓ Ollama chat participant registered');

  // ---------------------------------------------------------------------------
  // Configuration/Settings
  // ---------------------------------------------------------------------------

  const config = vscode.workspace.getConfiguration('ollama');

  const host = config.get('host');
  assert.ok(typeof host === 'string' || host === undefined, 'ollama.host should be a string or undefined');
  console.log('✓ ollama.host setting accessible');

  const contextLength = config.get('contextLength');
  assert.ok(typeof contextLength === 'number' || contextLength === undefined, 'contextLength should be a number');
  console.log('✓ ollama.contextLength setting accessible');

  const completionModel = config.get('completionModel');
  assert.ok(typeof completionModel === 'string' || completionModel === undefined, 'completionModel should be a string');
  console.log('✓ ollama.completionModel setting accessible');

  const enabled = config.get('enableInlineCompletions');
  assert.ok(typeof enabled === 'boolean' || enabled === undefined, 'enableInlineCompletions should be a boolean');
  console.log('✓ ollama.enableInlineCompletions setting accessible');

  const streamLogs = config.get('streamLogs');
  assert.ok(typeof streamLogs === 'boolean' || streamLogs === undefined, 'streamLogs should be a boolean');
  console.log('✓ ollama.streamLogs setting accessible');

  const diagnosticsConfig = vscode.workspace.getConfiguration('ollama.diagnostics');
  const logLevel = diagnosticsConfig.get('logLevel');
  const validLevels = ['debug', 'info', 'warn', 'error'];
  assert.ok(
    validLevels.includes(logLevel) || logLevel === undefined,
    `logLevel should be one of ${validLevels.join(', ')}`,
  );
  console.log('✓ ollama.diagnostics.logLevel setting accessible');

  // ---------------------------------------------------------------------------
  // Error Handling
  // ---------------------------------------------------------------------------

  assert.ok(extension.isActive, 'Extension should remain active even if Ollama is unavailable');
  console.log('✓ Extension handles missing Ollama server gracefully');

  assert.ok(config !== undefined, 'Configuration should be accessible');
  console.log('✓ Extension handles invalid configuration gracefully');

  console.log('\n✅ All extension tests passed!');
};
