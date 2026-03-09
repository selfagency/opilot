---
# ollama-models-vscode-ztdf
title: Add transport and parity tests
status: completed
type: task
priority: high
created_at: 2026-03-09T00:20:03Z
updated_at: 2026-03-09T00:20:07Z
parent: ollama-models-vscode-7d9m
branch: fix/xu20-xml-context-leak
pr: 45
---

Add/extend tests:

- SSE parser edge cases
- provider transport parity
- extension path parity
- XML leakage regression

Acceptance:

- targeted suites green

## Summary of Changes

Added transport and mapping coverage in `src/openaiCompat.test.ts` and `src/openaiCompatMapping.test.ts`, and verified parity with provider/extension behavior through targeted suites including XML leakage regressions.
