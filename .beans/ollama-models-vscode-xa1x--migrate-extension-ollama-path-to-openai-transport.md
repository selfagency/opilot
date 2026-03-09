---
# ollama-models-vscode-xa1x
title: Migrate extension @ollama path to OpenAI transport
status: completed
type: task
priority: high
created_at: 2026-03-09T00:20:03Z
updated_at: 2026-03-09T00:20:07Z
parent: ollama-models-vscode-7d9m
branch: fix/xu20-xml-context-leak
pr: 45
---

Replace direct `effectiveClient.chat` in participant path with OpenAI-compat transport while preserving:

- tool invocation loops
- XML tool fallback
- thinking/response formatting
- error behavior

## Summary of Changes

Migrated the `@ollama` participant path in `src/extension.ts` from direct SDK chat calls to OpenAI-compatible transport wrappers while preserving tool invocation loops, XML tool fallback behavior, response formatting, and error-path handling.
