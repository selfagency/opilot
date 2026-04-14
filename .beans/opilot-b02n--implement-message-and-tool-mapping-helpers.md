---
# opilot-b02n
title: Implement message and tool mapping helpers
status: completed
type: task
priority: high
created_at: 2026-03-09T00:20:03Z
updated_at: 2026-04-14T21:39:39Z
---

Add mapping layer for existing message/tool shapes to OpenAI chat-completions payload:

- role/content mapping
- vision parts mapping
- tool schema mapping
- tool result message mapping

Acceptance:

- parity with existing behavior for text/tools/images

## Summary of Changes

Added `src/openaiCompatMapping.ts` to map extension/provider message and tool structures into OpenAI-compatible payloads, including text/image part conversion, tool schema conversion, and tool-call/tool-result parity mapping.
