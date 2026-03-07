---
# ollama-models-vscode-r0ji
title: Add filter buttons to sidebar panes with clear-all toggle
status: completed
type: feature
priority: low
created_at: 2026-03-07T17:18:22Z
updated_at: 2026-03-07T18:30:46Z
---

Add a filter toolbar button to each sidebar pane (Local Models, Cloud Models, Library) that opens a search input. While a filter is active, the button changes to a clear-all icon. Filtering matches against item labels including children.

## Todo

- [x] Add `filterText: string` field to `LocalModelsProvider`, `CloudModelsProvider`, and `LibraryModelsProvider` in `src/sidebar.ts`
- [x] In each provider's `getChildren()`: apply case-insensitive include filter — if a group has no matching children hide it; if any child matches, include the group with only matching children
- [x] Register command `ollama-copilot.filterLocalModels`: call `vscode.window.showInputBox({ prompt: 'Filter local models', value: existing })`. On value: set `filterText`, set context `ollama.localFilterActive = true`, fire refresh. On cancel/empty: clear filter
- [x] Register command `ollama-copilot.clearLocalFilter`: clear `filterText`, set `ollama.localFilterActive = false`, fire refresh
- [x] Register command `ollama-copilot.filterCloudModels` / `ollama-copilot.clearCloudFilter`: same pattern for cloud provider
- [x] Register command `ollama-copilot.filterLibraryModels` / `ollama-copilot.clearLibraryFilter`: same pattern for library provider
- [x] Add 6 commands to `contributes.commands` in `package.json` with icons `$(filter)` and `$(clear-all)`
- [x] Add `view/title` menu entries with `when` conditionals: show filter button when `!ollama.localFilterActive`, show clear-all when `ollama.localFilterActive` (same for cloud and library)
- [x] Run `pnpm run compile` to verify TypeScript passes
- [x] Run `pnpm run test` to verify unit tests still pass (225/225 passed)

## Summary of Changes

- `src/sidebar.ts`: added `filterText = ''` to all three providers; filter top-level family groups in `getChildren()` by family name or child label (case-insensitive); registered 6 filter/clear commands delegating to `showInputBox` and `setContext`
- `package.json`: added 6 commands with `$(filter)` and `$(clear-all)` icons; added `view/title` menu entries with `when` conditionals toggling between filter and clear-filter icons
- `src/sidebar.test.ts`: added tests verifying all 6 commands are registered, and `LocalModelsProvider` correctly filters/unfilters family groups when `filterText` is set

Commit: ade843361178c69d9e1a95d88b63a9cf4f0f65d6
Branch: fix/r0ji-filter-buttons
