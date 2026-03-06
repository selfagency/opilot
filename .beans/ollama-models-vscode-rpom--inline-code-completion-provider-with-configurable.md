---
# ollama-models-vscode-rpom
title: Inline code completion provider with configurable model selection
status: scrapped
type: feat
priority: medium
created_at: 2026-03-06T05:23:54Z
updated_at: 2026-03-06T05:56:45Z
---

Implement a VS Code `InlineCompletionItemProvider` backed by Ollama `/api/generate` for ghost-text (autocomplete-as-you-type) completions.

## Problem

The extension currently only provides a chat model provider and an `@ollama` chat participant. There is no inline (ghost-text) code completion — pressing Tab does nothing Ollama-powered.

## Goals

- Register an `InlineCompletionItemProvider` via `vscode.languages.registerInlineCompletionItemProvider`
- Call Ollama `/api/generate` with fill-in-the-middle (FIM) support where the model supports it (e.g. `deepseek-coder`, `starcoder2`, `codellama:code`)
- Fall back to suffix-less generation for models that don't support FIM tokens
- Add a setting `ollama.completions.model` (string, default `""`) so users can select a dedicated completions model separate from the chat model
- Add a setting `ollama.completions.enabled` (boolean, default `true`) to allow disabling completions
- Debounce requests (e.g. 300ms) to avoid hammering Ollama on every keystroke
- Cap completion length (e.g. max 1 line by default, configurable)
- Cancel in-flight requests when the cursor moves

## Todo

- [ ] Add `ollama.completions.enabled` and `ollama.completions.model` settings to `package.json`
- [ ] Create `src/completions.ts` with `InlineCompletionProvider` class
- [ ] Write failing tests for the provider in `src/completions.test.ts`
- [ ] Implement FIM prompt construction (prefix/suffix split at cursor)
- [ ] Register provider in `activate()` (only when enabled)
- [ ] Add command `ollama.completions.selectModel` to choose completions model via QuickPick
- [ ] Wire command and setting into sidebar or status bar
- [ ] Manual smoke test with `qwen2.5-coder` and `starcoder2`
