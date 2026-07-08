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

describe('Extension Host E2E', () => {
  it('activates extension in the extension host and registers commands', async () => {
    // Use the vscode proxy provided by wdio-vscode-service via executeWorkbench
    const workbench = await browser.getWorkbench();
    const title = await workbench.getTitleBar().getTitle();
    expect(title).to.contain('Extension Development Host');

    const activated = await browser.executeWorkbench(async (vscode: unknown) => {
      const ext = (vscode as unknown as VscodeProxy).extensions.getExtension('selfagency.opilot');
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

    expect(activated).to.equal(true);

    // Verify expected critical commands exist (spot-check a subset)
    const expectedCommands = [
      'opilot.refreshModels',
      'opilot.startModel',
      'opilot.buildModelfile',
      'opilot.openExtensionSettings'
    ];
    // Execute inside the extension host to retrieve registered commands, then
    // compare on the test side to avoid referencing test-scope variables inside
    // the serialized function (closures are not transferred into the extension host).
    const registered = await browser.executeWorkbench(
      async (vscode: unknown) => await (vscode as unknown as VscodeProxy).commands.getCommands(true)
    );

    expect(Array.isArray(registered)).to.equal(true);
    const missing = expectedCommands.filter((c: string) => !registered.includes(c));
    expect(missing.length).to.equal(0, `Missing extension commands: ${missing.join(', ')}`);
  });
});
