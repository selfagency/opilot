---
# ollama-models-vscode-bm0h
title: Add grouped/flat view toggle per sidebar pane with alphabetical sort
status: todo
type: feature
priority: low
created_at: 2026-03-07T17:30:43Z
updated_at: 2026-03-07T17:30:43Z
---

Add a toggle button per sidebar pane (Local Models, Cloud Models, Library) that switches between grouped/parented view and a flat alphabetically-sorted list. When parenting is off, all models are shown as a flat list sorted A–Z with no group headers.

## Behaviour

- **Parenting on** (default): models grouped by family/tag as they are now
- **Parenting off**: all models shown as a flat, case-insensitive alphabetically sorted list with no group headers
- Toggle state is persisted per pane in extension global state so it survives reloads
- Toggle icon: `$(list-tree)` when grouped, `$(list-flat)` when flat (or similar pair — confirm available icons)

## Todo

- [ ] Add `grouped: boolean` state field (default `true`) to `LocalModelsProvider`, `CloudModelsProvider`, and `LibraryModelsProvider` in `src/sidebar.ts`
- [ ] In each provider's `getChildren()`: when `grouped === false`, bypass group structure — collect all leaf model items, sort them case-insensitively by label, return the flat array
- [ ] Persist `grouped` state using `context.globalState.get/update('ollama.localGrouped', true)` (and cloud/library equivalents) so the preference survives restarts
- [ ] Register command `ollama-copilot.toggleLocalGrouping`: flip `grouped`, update global state, set context var `ollama.localGrouped`, fire refresh
- [ ] Register command `ollama-copilot.toggleCloudGrouping`: same for cloud provider
- [ ] Register command `ollama-copilot.toggleLibraryGrouping`: same for library provider
- [ ] Add 3 commands to `contributes.commands` in `package.json` with appropriate icons and titles
- [ ] Add `view/title` menu entries with `when` conditionals toggling between grouped/flat icon states
- [ ] Run `pnpm run compile` to verify TypeScript passes
- [ ] Run `pnpm run test` to verify unit tests still pass
