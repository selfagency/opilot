---
# ollama-models-vscode-36w3
title: Prevent deleting a running model
status: completed
type: feature
priority: high
created_at: 2026-03-07T17:17:45Z
updated_at: 2026-03-07T17:55:00Z
branch: fix/36w3-prevent-delete-running-model
---

The delete model button appears in the context menu for running models (`local-running`, `cloud-running`). Deleting a running model can leave the model runner in a bad state.

## Todo

- [x] Remove `{"command": "ollama-copilot.deleteModel", "when": "view == ollama-local-models && viewItem == local-running", ...}` from `view/item/context` in `package.json`
- [x] Remove `{"command": "ollama-copilot.deleteModel", "when": "view == ollama-cloud-models && viewItem == cloud-running", ...}` from `view/item/context` in `package.json`
- [x] In `src/sidebar.ts` `handleDeleteModel()`: add guard — if `item.type === 'local-running' || item.type === 'cloud-running'`, call `vscode.window.showErrorMessage('Stop the model before deleting it.')` and return early
- [x] Run `pnpm run compile` to verify TypeScript passes
- [x] Run `pnpm run test` to verify unit tests still pass

## Summary of Changes

- `package.json`: Removed `deleteModel` context menu entries for `local-running` and `cloud-running` viewItem states.
- `src/sidebar.ts`: Added early return guard in `handleDeleteModel` that shows an error message and blocks deletion when the model is running.
- `src/sidebar.test.ts`: Two new tests verify the guard works for both `local-running` and `cloud-running` model types.
