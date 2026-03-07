---
# ollama-models-vscode-bm0h
title: Add grouped/flat view toggle per sidebar pane with alphabetical sort
status: completed
type: feature
priority: low
created_at: 2026-03-07T17:30:43Z
updated_at: 2026-03-07T18:36:46Z
---

Add a toggle button per sidebar pane (Local Models, Cloud Models, Library) that switches between grouped/parented view and a flat alphabetically-sorted list. When parenting is off, all models are shown as a flat list sorted A–Z with no group headers.

## Behaviour

- **Parenting on** (default): models grouped by family/tag as they are now
- **Parenting off**: all models shown as a flat, case-insensitive alphabetically sorted list with no group headers
- Toggle state is persisted per pane in extension global state so it survives reloads
- Toggle icon: `$(list-tree)` when grouped, `$(list-flat)` when flat

## Todo

- [x] Add `grouped: boolean` state field (default `true`) to all three providers
- [x] Flat mode in each provider's `getChildren()`: bypass group structure, return flat sorted list
- [x] Persist `grouped` state in `globalState`
- [x] Register `toggleLocalGrouping`, `toggleCloudGrouping`, `toggleLibraryGrouping` commands
- [x] Add 3 commands to `package.json` with `$(list-tree)` icon
- [x] Add `view/title` menu entries for all three views
- [x] Compile passes, 228 tests pass

## Summary of Changes

- Added `grouped = true` field to all three sidebar providers
- Each provider's `getChildren()` top-level checks `!this.grouped` first: returns flat case-insensitive sorted list bypassing group structure
- Toggle commands registered: flip `grouped`, persist to `globalState`, set context var, call `refresh()`
- Commit: `4e1c95085287c8e23d78ed7e87af9b7aaf21beaf`, branch: `fix/bm0h-grouped-flat-toggle`
