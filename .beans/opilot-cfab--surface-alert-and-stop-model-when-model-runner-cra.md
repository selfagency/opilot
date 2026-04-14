---
# opilot-cfab
title: Surface alert and stop model when model runner crashes (SIGSEGV)
status: completed
type: feature
priority: medium
created_at: 2026-03-07T17:17:53Z
updated_at: 2026-03-07T17:19:57Z
branch: fix/cfab-surface-crash-alert
id: opilot-cfab
---

When the Ollama model runner crashes (SIGSEGV), the chat API throws an error with message "model runner has unexpectedly stopped...". Currently this is caught silently — no UI alert is shown and the model is not unloaded.

## Todo

- [x] In `src/provider.ts` catch block of `provideLanguageModelChatResponse()`: detect `error.message.includes('model runner has unexpectedly stopped')`. If detected:
  - Attempt `perRequestClient.generate({ model: runtimeModelId, prompt: '', keep_alive: 0, stream: false })` to force-unload (ignore failure)
  - Call `vscode.window.showErrorMessage('The Ollama model runner crashed. Please check the Ollama server logs and restart if needed.', 'Open Logs')`
- [x] In `src/extension.ts` catch block of `handleChatRequest()`: same detection + `vscode.window.showErrorMessage(...)` with guidance
- [x] Run `pnpm run compile` to verify TypeScript passes
- [x] Run `pnpm run test` to verify unit tests still pass

## Summary of Changes

- `src/provider.ts`: crash detection in `provideLanguageModelChatResponse()` catch block — forces model unload and shows error message
- `src/extension.ts`: same crash detection in the chat participant catch block
- `src/provider.test.ts`: new `describe('OllamaChatModelProvider crash handling')` with a test verifying `showErrorMessage` is called and `generate` is called with `keep_alive: 0`
- `src/test/vscode.mock.ts`: added `showErrorMessage: vi.fn()` to the `window` mock
