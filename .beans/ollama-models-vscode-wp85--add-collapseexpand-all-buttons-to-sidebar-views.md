---
# ollama-models-vscode-wp85
title: Add collapse/expand all buttons to sidebar views
status: completed
type: feature
priority: low
created_at: 2026-03-07T17:18:13Z
updated_at: 2026-03-07T18:25:38Z
---

Add a collapse-all toolbar button to the Local Models, Cloud Models, and Library sidebar views. No expand-all button — VS Code's native tree expand-all is sufficient, and triggering it programmatically is not reliably supported.

## Todo

- [x] In `src/sidebar.ts` `registerSidebar()`: switch `registerTreeDataProvider` to `createTreeView` for local, cloud, and library views to obtain `TreeView` references
- [x] Register command `ollama-copilot.collapseLocalModels`: delegates to built-in `workbench.actions.treeView.ollama-local-models.collapseAll` via `commands.executeCommand`
- [x] Register command `ollama-copilot.collapseCloudModels`: delegates to built-in `workbench.actions.treeView.ollama-cloud-models.collapseAll`
- [x] Register command `ollama-copilot.collapseLibrary`: delegates to built-in `workbench.actions.treeView.ollama-library-models.collapseAll`
- [x] Add 3 commands to `contributes.commands` in `package.json` with icon `$(collapse-all)` and appropriate titles
- [x] Add `view/title` menu entries in `package.json` for each view pointing to the collapse command
- [x] Run `pnpm run compile` to verify TypeScript passes
- [x] Run `pnpm run test` to verify unit tests still pass (221/221 passed)

## Summary of Changes

- `src/sidebar.ts`: switched 3 `registerTreeDataProvider` calls to `createTreeView`; registered 3 collapse commands using `commands.executeCommand('workbench.actions.treeView.{id}.collapseAll')` (note: `TreeView<T>.collapseAll()` is not exposed in `@types/vscode`, so the built-in command is used instead)
- `src/test/vscode.mock.ts`: added `createTreeView: vi.fn(() => ({ dispose: vi.fn() }))` to window mock
- `package.json`: added 3 commands (`collapseLocalModels`, `collapseCloudModels`, `collapseLibrary`) and 3 `view/title` menu entries with `navigation@0` group
- `src/sidebar.test.ts`: added test verifying all three commands are registered and call the correct built-in `executeCommand` target

Commit: c8297300ad4d73aac0894bf9ef7fab49ec42ad3b
Branch: fix/wp85-collapse-all-buttons
