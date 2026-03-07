---
# ollama-models-vscode-r0ji
title: Add filter buttons to sidebar panes with clear-all toggle
status: todo
type: feature
priority: low
created_at: 2026-03-07T17:18:22Z
updated_at: 2026-03-07T17:19:06Z
---

Add a filter toolbar button to each sidebar pane (Local Models, Cloud Models, Library) that opens a search input. While a filter is active, the button changes to a clear-all icon. Filtering matches against item labels including children.

## Todo

- [ ] Add `filterText: string` field to `LocalModelsProvider`, `CloudModelsProvider`, and `LibraryModelsProvider` in `src/sidebar.ts`
- [ ] In each provider's `getChildren()`: apply case-insensitive include filter — if a group has no matching children hide it; if any child matches, include the group with only matching children
- [ ] Register command `ollama-copilot.filterLocalModels`: call `vscode.window.showInputBox({ prompt: 'Filter local models', value: existing })`. On value: set `filterText`, set context `ollama.localFilterActive = true`, fire refresh. On cancel/empty: clear filter
- [ ] Register command `ollama-copilot.clearLocalFilter`: clear `filterText`, set `ollama.localFilterActive = false`, fire refresh
- [ ] Register command `ollama-copilot.filterCloudModels` / `ollama-copilot.clearCloudFilter`: same pattern for cloud provider
- [ ] Register command `ollama-copilot.filterLibraryModels` / `ollama-copilot.clearLibraryFilter`: same pattern for library provider
- [ ] Add 6 commands to `contributes.commands` in `package.json` with icons `$(filter)` and `$(clear-all)`
- [ ] Add `view/title` menu entries with `when` conditionals: show filter button when `!ollama.localFilterActive`, show clear-all when `ollama.localFilterActive` (same for cloud and library)
- [ ] Run `pnpm run compile` to verify TypeScript passes
- [ ] Run `pnpm run test` to verify unit tests still pass
