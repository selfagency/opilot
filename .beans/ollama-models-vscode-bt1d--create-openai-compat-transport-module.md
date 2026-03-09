---
# ollama-models-vscode-bt1d
title: Create OpenAI-compat transport module
status: completed
type: task
priority: high
created_at: 2026-03-09T00:20:03Z
updated_at: 2026-03-09T00:20:07Z
parent: ollama-models-vscode-7d9m
branch: fix/xu20-xml-context-leak
pr: 45
---

Implement `src/openaiCompat.ts` with:

- headers/auth helpers
- URL helper
- streaming SSE parser
- non-stream completions call
- typed response fragments

Acceptance:

- Handles split chunks and [DONE]
- Emits tool call deltas and text deltas robustly

## Summary of Changes

Implemented `src/openaiCompat.ts` with OpenAI-compatible chat-completions transport, including non-stream request support, streaming SSE parsing with split-chunk handling, response delta extraction, and robust terminal `[DONE]` handling.
