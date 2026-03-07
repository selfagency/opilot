---
# ollama-models-vscode-wp85
title: Add collapse/expand all buttons to sidebar views
status: todo
type: feature
priority: low
created_at: 2026-03-07T17:18:13Z
updated_at: 2026-03-07T17:30:27Z
---

Add a collapse-all toolbar button to the Local Models, Cloud Models, and Library sidebar views. No expand-all button — VS Code's native tree expand-all is sufficient, and triggering it programmatically is not reliably supported.

## Todo

- [ ] In `src/sidebar.ts` `registerSidebar()`: switch `registerTreeDataProvider` to `createTreeView` for local, cloud, and library views to obtain `TreeView` references
- [ ] Register command `ollama-copilot.collapseLocalModels`: call `localTreeView.collapseAll()`
- [ ] Register command `ollama-copilot.collapseCloudModels`: call `cloudTreeView.collapseAll()`
- [ ] Register command `ollama-copilot.collapseLibrary`: call `libraryTreeView.collapseAll()`
- [ ] Add 3 commands to `contributes.commands` in `package.json` with icon `$(collapse-all)` and appropriate titles
- [ ] Add `view/title` menu entries in `package.json` for each view pointing to the collapse command
- [ ] Run `pnpm run compile` to verify TypeScript passes
- [ ] Run `pnpm run test` to verify unit tests still pass
