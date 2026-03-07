---
# ollama-models-vscode-wp85
title: Add collapse/expand all buttons to sidebar views
status: todo
type: feature
priority: low
created_at: 2026-03-07T17:18:13Z
updated_at: 2026-03-07T17:19:03Z
---

Add collapse all / expand all toolbar buttons to the Local Models and Cloud Models sidebar views, and a collapse-only button to the Library view.

## Todo

- [ ] In `src/sidebar.ts` `registerSidebar()`: switch `registerTreeDataProvider` to `createTreeView` for local, cloud, and library views to obtain `TreeView` references
- [ ] Add `forcedCollapse: boolean` flag to `LocalModelsProvider` and `CloudModelsProvider`; when set, items return `vscode.TreeItemCollapsibleState.Collapsed`; when clear, use default
- [ ] Register command `ollama-copilot.collapseLocalModels`: set `forcedCollapse = true`, set context `ollama.localCollapsed = true`, fire refresh
- [ ] Register command `ollama-copilot.expandLocalModels`: set `forcedCollapse = false`, set context `ollama.localCollapsed = false`, fire refresh
- [ ] Register command `ollama-copilot.collapseCloudModels`: set `forcedCollapse = true`, set context `ollama.cloudCollapsed = true`, fire refresh
- [ ] Register command `ollama-copilot.expandCloudModels`: set `forcedCollapse = false`, set context `ollama.cloudCollapsed = false`, fire refresh
- [ ] Register command `ollama-copilot.collapseLibrary`: call `treeView.collapseAll()` (no expand for library)
- [ ] Add 5 commands to `contributes.commands` in `package.json` with icons `$(collapse-all)` / `$(expand-all)`
- [ ] Add `view/title` menu entries in `package.json`: local/cloud get collapse (when not collapsed) + expand (when collapsed); library gets collapse-only
- [ ] Run `pnpm run compile` to verify TypeScript passes
- [ ] Run `pnpm run test` to verify unit tests still pass
