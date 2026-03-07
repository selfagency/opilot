---
# ollama-models-vscode-36w3
title: Prevent deleting a running model
status: todo
type: feature
priority: high
created_at: 2026-03-07T17:17:45Z
updated_at: 2026-03-07T17:20:01Z
---

The delete model button appears in the context menu for running models (`local-running`, `cloud-running`). Deleting a running model can leave the model runner in a bad state.

## Todo

- [ ] Remove `{"command": "ollama-copilot.deleteModel", "when": "view == ollama-local-models && viewItem == local-running", ...}` from `view/item/context` in `package.json`
- [ ] Remove `{"command": "ollama-copilot.deleteModel", "when": "view == ollama-cloud-models && viewItem == cloud-running", ...}` from `view/item/context` in `package.json`
- [ ] In `src/sidebar.ts` `handleDeleteModel()`: add guard — if `item.type === 'local-running' || item.type === 'cloud-running'`, call `vscode.window.showErrorMessage('Stop the model before deleting it.')` and return early
- [ ] Run `pnpm run compile` to verify TypeScript passes
- [ ] Run `pnpm run test` to verify unit tests still pass
