/* eslint-env node */
const path = require('node:path');

exports.config = {
  runner: 'local',
  specs: ['./test/extension/host.e2e.ts', './test/extension/e2e.spec.ts'],
  maxInstances: 1,
  capabilities: [
    {
      browserName: 'vscode',
      browserVersion: 'stable',
      'wdio:vscodeOptions': {
        extensionPath: path.join(process.cwd()),
        userSettings: {
          'editor.fontSize': 12
        }
      },
      'goog:chromeOptions': {
        // Ensure VS Code is launched with proposed API enabled for this extension
        // Also accept additional CLI args via environment variable WDIO_VSCODE_ARGS
        args: process.env.WDIO_VSCODE_ARGS
          ? process.env.WDIO_VSCODE_ARGS.split(' ')
          : ['--enable-proposed-api=selfagency.opilot']
      }
    }
  ],
  logLevel: 'info',
  bail: 0,
  baseUrl: 'http://localhost',
  waitforTimeout: 10_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 3,
  services: ['vscode'],
  // Ensure vscode proxy is enabled so executeWorkbench works reliably
  vscodeProxyOptions: {
    enable: true,
    connectionTimeout: 10_000,
    commandTimeout: 10_000
  },
  framework: 'mocha',
  reporters: ['spec']
};
