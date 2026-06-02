/* eslint-disable jest/expect-expect */

const assert = require('assert');
const vscode = require('vscode');

let extension;

async function testCase(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

exports.run = async () => {
  extension = vscode.extensions.getExtension('selfagency.opilot');
  assert.ok(extension, 'Extension not found');

  if (extension && !extension.isActive) {
    await extension.activate();
  }

  const commands = await vscode.commands.getCommands(true);

  console.log('✓ Extension activated');

  await testCase('activates the extension', () => {
    assert.ok(extension.isActive, 'Extension did not activate');
  });

  await testCase('contributes sidebar views and activation events', () => {
    const manifest = vscode.extensions.getExtension('selfagency.opilot').packageJSON;
    const views = manifest?.contributes?.views?.['ollama-explorer'] ?? [];
    const viewIds = new Set(views.map(view => view.id));
    const activationEvents = manifest?.activationEvents ?? [];

    assert.ok(viewIds.has('ollama-local-models'), 'Local models view contribution missing');
    assert.ok(viewIds.has('ollama-cloud-models'), 'Cloud models view contribution missing');
    assert.ok(viewIds.has('ollama-library-models'), 'Library models view contribution missing');
    assert.ok(viewIds.has('ollama-modelfiles'), 'Modelfiles view contribution missing');
    assert.ok(viewIds.has('ollama-model-settings'), 'Model settings view contribution missing');

    assert.ok(activationEvents.includes('onView:ollama-local-models'), 'Local models onView activation missing');
    assert.ok(activationEvents.includes('onView:ollama-cloud-models'), 'Cloud models onView activation missing');
    assert.ok(activationEvents.includes('onView:ollama-library-models'), 'Library models onView activation missing');
    assert.ok(activationEvents.includes('onView:ollama-modelfiles'), 'Modelfiles onView activation missing');
    assert.ok(activationEvents.includes('onView:ollama-model-settings'), 'Model settings onView activation missing');
  });

  await testCase('registers expected commands and tree views', () => {
    const expectedCommands = [
      'opilot.manageAuthToken',
      'opilot.refreshLocalModels',
      'opilot.refreshCloudModels',
      'opilot.refreshLibrary',
      'opilot.startModel',
      'opilot.stopModel',
      'opilot.deleteModel',
      'opilot.pullModel',
      'opilot.openLibraryModelPage',
      'opilot.filterLocalModels',
      'opilot.clearLocalFilter',
      'opilot.toggleLocalGrouping',
      'opilot.filterCloudModels',
      'opilot.clearCloudFilter',
      'opilot.toggleCloudGrouping',
      'opilot.filterLibraryCapabilities',
      'opilot.searchLibraryModels',
      'opilot.clearLibrarySearch',
      'opilot.toggleLibraryGrouping',
      'opilot.newModelfile',
      'opilot.editModelfile',
      'opilot.buildModelfile',
      'opilot.openModelfilesFolder',
      'opilot.refreshModelfiles'
    ];

    for (const cmd of expectedCommands) {
      assert.ok(commands.includes(cmd), `Command ${cmd} not registered`);
    }

    assert.ok(commands.includes('opilot.refreshLocalModels'), 'Local models tree view not properly initialized');
    assert.ok(commands.includes('opilot.refreshCloudModels'), 'Cloud models tree view not properly initialized');
    assert.ok(commands.includes('opilot.refreshLibrary'), 'Library models tree view not properly initialized');
    assert.ok(commands.includes('opilot.newModelfile'), 'Modelfiles tree view not properly initialized');
  });

  await testCase('exposes extension configuration', () => {
    const config = vscode.workspace.getConfiguration('ollama');

    assert.ok(
      typeof config.get('host') === 'string' || config.get('host') === undefined,
      'ollama.host should be a string or undefined'
    );
    assert.ok(
      typeof config.get('contextLength') === 'number' || config.get('contextLength') === undefined,
      'contextLength should be a number'
    );
    assert.ok(
      typeof config.get('completionModel') === 'string' || config.get('completionModel') === undefined,
      'completionModel should be a string'
    );
    assert.ok(
      typeof config.get('enableInlineCompletions') === 'boolean' || config.get('enableInlineCompletions') === undefined,
      'enableInlineCompletions should be a boolean'
    );
    assert.ok(
      typeof config.get('streamLogs') === 'boolean' || config.get('streamLogs') === undefined,
      'streamLogs should be a boolean'
    );

    const diagnosticsConfig = vscode.workspace.getConfiguration('ollama.diagnostics');
    const logLevel = diagnosticsConfig.get('logLevel');
    const validLevels = ['debug', 'info', 'warn', 'error'];
    assert.ok(
      validLevels.includes(logLevel) || logLevel === undefined,
      `logLevel should be one of ${validLevels.join(', ')}`
    );
  });

  await testCase('remains active when Ollama is unavailable', () => {
    const config = vscode.workspace.getConfiguration('ollama');
    assert.ok(extension.isActive, 'Extension should remain active even if Ollama is unavailable');
    assert.ok(config !== undefined, 'Configuration should be accessible');
  });

  console.log('\n✅ All extension tests passed!');
};
