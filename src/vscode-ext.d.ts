// Augment the vscode module to add joinPath, which is missing from the
// vscode@1.1.37 type stubs used in the test environment.
declare module 'vscode' {
  // biome-ignore lint/style/noNamespace: module augmentation requires namespace syntax in .d.ts
  namespace Uri {
    function joinPath(base: Uri, ...pathSegments: string[]): Uri;
  }
}
