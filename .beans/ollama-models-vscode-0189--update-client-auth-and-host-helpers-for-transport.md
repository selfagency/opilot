---
# ollama-models-vscode-0189
title: Update client auth and host helpers for transport
status: completed
type: task
priority: normal
created_at: 2026-03-09T00:20:03Z
updated_at: 2026-03-09T00:20:07Z
parent: ollama-models-vscode-7d9m
branch: fix/xu20-xml-context-leak
pr: 45
---

In `src/client.ts`, expose host/auth helpers for OpenAI transport while keeping SDK client creation for sidebar/model-management unchanged.

## Summary of Changes

Updated `src/client.ts` to expose host/auth accessors for the OpenAI-compatible transport while preserving SDK-based sidebar/model-management operations.
