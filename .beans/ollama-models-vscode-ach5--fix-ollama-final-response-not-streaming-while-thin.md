---
# ollama-models-vscode-ach5
title: Fix Ollama final response not streaming while thinking streams
status: completed
type: bug
priority: high
created_at: 2026-03-16T22:03:11Z
updated_at: 2026-03-16T22:14:07Z
---

## Context
The thinking stream from Ollama is visible progressively, but the assistant final response is buffered and only appears after completion.

## Todo
- [x] Reproduce/inspect current streaming flow for thinking vs final response
- [x] Identify buffering point in provider/extension output path
- [x] Implement fix so final response tokens stream incrementally
- [x] Add or update tests to prevent regression
- [x] Run relevant tests and verify behavior

## Summary of Changes
- Fixed VS Code LM fallback streaming path to emit `LanguageModelTextPart` chunks immediately as they arrive, instead of buffering until stream completion.
- Kept assistant text accumulation for conversation continuity in tool-call rounds, while avoiding duplicate end-of-round replay.
- Added a regression test proving the first text chunk is rendered before stream completion.

## Tracking
- Branch: `fix/ach5-stream-final-response`

## Follow-up (Cancellation)
- Added `token.isCancellationRequested` guard inside the VS Code LM API `for await (const chunk of response.stream)` loop and break early on cancellation.
- Added regression test to verify chunks after cancellation are not emitted.
- Verified with targeted `src/extension.test.ts` run (pass).
