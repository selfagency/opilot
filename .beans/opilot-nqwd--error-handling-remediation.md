---
# opilot-nqwd
title: Error handling remediation
status: todo
type: epic
priority: high
created_at: 2026-04-14T21:37:16Z
updated_at: 2026-04-14T21:43:48Z
parent: opilot-fu6s
---

Improve diagnostic quality and graceful failure behavior for chat, transport, and tool execution flows.

## Included Findings

- 009 OpenAI-compatible fallback errors silently swallowed
- 010 Stream iteration lacks guarded error handling
- 011 `testConnection()` silently returns false without diagnostics
- 012 `task_complete` tool-call error is silently ignored

## Todo

- [ ] Review all silent catch blocks and stream failure paths
- [ ] Create child issues for each error handling finding
- [ ] Define consistent logging and user-facing error reporting expectations
- [ ] Verify the epic covers all error handling findings from the plan
