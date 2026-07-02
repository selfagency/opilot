import { join } from 'node:path';
import type { Options } from '@wdio/types';

export const config: Options.Testrunner = {
  runner: 'local',
  specs: ['./test/extension/e2e.spec.ts'],
  maxInstances: 1,
  capabilities: [
    {
      browserName: 'vscode',
      browserVersion: 'stable',
      'wdio:vscodeOptions': {
        extensionPath: join(process.cwd()),
        userSettings: {
          'editor.fontSize': 12
        }
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
  framework: 'mocha',
  reporters: ['spec']
};

export default config;
