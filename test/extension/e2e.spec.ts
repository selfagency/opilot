/// <reference types="@wdio/globals/types" />
/* global browser */
interface VscodeProxy {
  commands: { getCommands(all: boolean): Promise<string[]> };
  extensions: {
    getExtension(id: string): { isActive?: boolean; activate?: () => Promise<unknown> } | undefined;
  };
}

interface BrowserProxy {
  executeWorkbench<T>(fn: (vscode: VscodeProxy) => Promise<T> | T): Promise<T>;
  getWorkbench(): { getTitleBar(): { getTitle(): Promise<string> } };
}

declare const browser: BrowserProxy;

import { expect } from 'chai';

describe('Extension E2E', () => {
  it('activates and registers commands', async () => {
    // browser is provided by wdio/vscode service at runtime; reference only inside test
    const workbench = await browser.getWorkbench();
    const title = await workbench.getTitleBar().getTitle();
    expect(title).to.contain('Extension Development Host');

    // Ensure the extension activates and registers commands
    // Avoid UI helper methods; assert activation via VS Code extension API
    const isActive = await browser.executeWorkbench(async (vscode: unknown) => {
      const ext = (vscode as any).extensions.getExtension('selfagency.opilot');
      if (!ext) {
        return false;
      }
      if (ext.isActive) {
        return true;
      }
      try {
        await ext.activate();
        return true;
      } catch {
        return false;
      }
    });
    expect(isActive).to.equal(true);

    // Verify a core set of commands are registered by the extension
    const expectedCommands = [
      'opilot.refreshModels',
      'opilot.startModel',
      'opilot.buildModelfile',
      'opilot.openExtensionSettings'
    ];
    const missing = await browser.executeWorkbench(async (vscode: unknown) => {
      const cmds = await (vscode as any).commands.getCommands(true);
      return expectedCommands.filter((c: string) => !cmds.includes(c));
    });
    expect(Array.isArray(missing)).to.equal(true);
    expect(missing.length).to.equal(0, `Missing extension commands: ${missing.join(', ')}`);
  });
});
