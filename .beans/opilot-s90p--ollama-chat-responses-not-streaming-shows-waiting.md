---
# opilot-s90p
title: Ollama chat responses not streaming — shows "waiting" indefinitely
status: completed
type: fix
priority: critical
created_at: 2026-03-05T22:03:38Z
updated_at: 2026-03-05T22:33:21Z
---

## Root Cause

Two bugs in `provideLanguageModelChatResponse` (`src/provider.ts`):

1. **Missing `await`**: `this.client.chat({ stream: true })` returns `Promise<AbortableAsyncIterator<ChatResponse>>`. Without `await`, the `for await...of` loop was iterating over the Promise itself — so the loop body never executed and `progress.report()` was never called, leaving VS Code stuck on "waiting".

2. **Text batching**: Even if the `await` had been present, text chunks were accumulated in a `currentText` string and only flushed via `progress.report()` after the entire loop completed. VS Code requires each chunk to be reported immediately to display streaming output.

## Changes

- `src/provider.ts`: Added `await` to `this.client.chat(...)`. Replaced `currentText` accumulation with immediate `progress.report(new LanguageModelTextPart(chunk.message.content))` per chunk. Removed end-of-loop flush. Fixed `toolCall.id` type error (`ToolCall` has no `id` field in the Ollama JS library).
- `src/provider.test.ts`: Added test asserting each of 3 yielded chunks is reported as a separate `LanguageModelTextPart` call (not batched).

## Summary of Changes

- Fixed streaming so each token is reported to VS Code immediately as it arrives
- 127 tests passing, clean compile
