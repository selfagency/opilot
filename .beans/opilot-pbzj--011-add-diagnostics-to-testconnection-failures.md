---
# opilot-pbzj
title: 011 Add diagnostics to testConnection failures
status: todo
type: bug
priority: low
created_at: 2026-04-14T21:38:28Z
updated_at: 2026-04-14T21:38:28Z
parent: opilot-nqwd
id: opilot-pbzj
---

Source issue 011 from `docs/plans/remediation-plan.md`.

## Summary

`testConnection()` currently returns `false` on failure without distinguishing the underlying cause.

## Files

- `src/client.ts`

## Remediation Goal

Provide enough diagnostic detail to distinguish timeout, connection refusal, authentication issues, and other known failure modes.

## Todo

- [ ] Review the current `testConnection()` error handling path
- [ ] Add categorized error handling or logging for common failure classes
- [ ] Keep the public return contract compatible where required
- [ ] Add tests for representative failure modes
- [ ] Verify callers can now surface more actionable troubleshooting guidance
