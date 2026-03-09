---
# ollama-models-vscode-7d9m
title: Migrate LLM interactions to OpenAI-compat transport (no flag)
status: completed
type: epic
priority: high
created_at: 2026-03-09T00:19:52Z
updated_at: 2026-03-09T00:19:52Z
branch: fix/xu20-xml-context-leak
pr: 45
---

## Goal

Migrate chat/completion transport to Ollama OpenAI-compat HTTP endpoints while preserving Ollama SDK usage for sidebar/model-management.

## Todo

- [x] Create shared OpenAI-compat transport (SSE + non-stream)
- [x] Add message/tool mapping helpers
- [x] Migrate provider chat path
- [x] Migrate @ollama participant path
- [x] Update client auth/host plumbing
- [x] Expand tests for new transport and parity
- [x] Run full validation and compile

## Notes

- No feature flag (pre-release product per user decision)
- Preserve existing XML sanitation behavior

## Summary of Changes

Completed end-to-end migration of LLM interaction paths to OpenAI-compatible transport in provider and `@ollama` extension flows, added shared transport/mapping modules and tests, and validated via precommit, targeted tests, and compile.
