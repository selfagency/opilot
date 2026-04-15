---
# opilot-pbzj
title: 011 Add diagnostics to testConnection failures
status: completed
type: bug
priority: low
created_at: 2026-04-14T21:38:28Z
updated_at: 2026-04-15T01:20:00Z
parent: opilot-nqwd
---

Source issue 011 from `docs/plans/remediation-plan.md`.

## Summary

`testConnection()` currently returns `false` on failure without distinguishing the underlying cause.

## Files

- `src/client.ts`

## Remediation Goal

Provide enough diagnostic detail to distinguish timeout, connection refusal, authentication issues, and other known failure modes.

## Todo

- [x] Review the current `testConnection()` error handling path
- [x] Add categorized error handling or logging for common failure classes
- [x] Keep the public return contract compatible where required
- [x] Add tests for representative failure modes
- [x] Verify callers can now surface more actionable troubleshooting guidance

## Summary of Changes

- Extended `testConnection` in `src/client.ts` with optional failure callback and categorized failure details (`timeout`, `connection-refused`, `authentication`, `cancelled`, `unknown`) while keeping boolean return compatibility.
- Added startup diagnostics warning in `src/extension.ts` to log categorized connection test failure reasons.
- Added representative tests in `src/client.test.ts` for timeout and authentication diagnostics callbacks (in addition to existing success/failure/cancellation behavior).

Validation run:

- `pnpm vitest run src/client.test.ts src/extension.test.ts`
- `pnpm run compile`
