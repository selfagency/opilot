---
# opilot-bxdx
title: 029 Add timeout protection to testConnection
status: todo
type: bug
priority: normal
created_at: 2026-04-14T21:39:33Z
updated_at: 2026-04-14T21:39:33Z
parent: opilot-1poi
id: opilot-bxdx
---

Source issue 029 from `docs/plans/remediation-plan.md`.

## Summary

`testConnection()` has no timeout protection, which can leave connection checks hanging longer than users expect.

## Files

- `src/client.ts`

## Remediation Goal

Use bounded timeout behavior so connection testing fails predictably and callers can surface clearer guidance.

## Todo

- [ ] Review how `testConnection()` currently performs network requests
- [ ] Add timeout support using the appropriate cancellation mechanism
- [ ] Ensure timeout behavior is distinguishable from other failure types
- [ ] Add tests for success, timeout, and cancellation behavior
- [ ] Verify callers receive a predictable and useful failure outcome
