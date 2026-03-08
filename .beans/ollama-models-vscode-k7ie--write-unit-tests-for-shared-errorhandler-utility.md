---
# ollama-models-vscode-k7ie
title: Write unit tests for shared errorHandler utility
status: in-progress
type: task
priority: low
created_at: 2026-03-08T16:41:44Z
updated_at: 2026-03-08T16:54:42Z
---

Write unit tests for the shared `reportError()` utility in `src/errorHandler.ts` to validate its logging and user-notification behavior.

## Context

`src/errorHandler.ts` was introduced as a shared error reporting utility used across `src/modelfiles.ts`, `src/sidebar.ts`, `src/extension.ts`, and `src/provider.ts`. It has no dedicated test file. Testing it in isolation ensures its contract (stack-trace logging, optional user dialog, no-throw guarantee) is verified and won't regress.

## Todo

- [ ] Create `src/errorHandler.test.ts`
- [ ] Test that `reportError()` logs the error message and stack trace via the provided DiagnosticsLogger
- [ ] Test that `showToUser: true` triggers `vscode.window.showErrorMessage`
- [ ] Test that `showToUser: false` (default) does not trigger the dialog
- [ ] Test that `reportError()` does not throw even when passed a non-Error value
- [ ] Run `task unit-tests` to confirm all tests pass

## Files

- `src/errorHandler.ts`
- `src/errorHandler.test.ts` (new)
