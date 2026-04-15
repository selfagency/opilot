---
# opilot-4kgr
title: 031 Clarify the getSetting return-type API
status: completed
type: task
priority: low
created_at: 2026-04-14T21:40:17Z
updated_at: 2026-04-15T01:13:00Z
parent: opilot-g952
---

Source issue 031 from `docs/plans/remediation-plan.md`.

## Summary

The `getSetting` API shape is considered harder to understand than it should be, which adds friction for callers and future maintenance.

## Files

- `src/settings.ts`
- any direct call sites affected by the API refinement

## Remediation Goal

Make the return type and call contract clearer without introducing unnecessary abstraction or breaking consumers unexpectedly.

## Todo

- [x] Review the current `getSetting` API and identify the main ambiguity for callers
- [x] Choose the smallest API refinement that improves clarity
- [x] Update the implementation and any affected call sites
- [x] Add or update tests to lock in the intended contract
- [x] Verify the API now reads clearly to a new maintainer

## Summary of Changes

This issue is satisfied by the existing `getSetting` overload contract in `src/settings.ts`:

- `getSetting<T>(key): T | undefined`
- `getSetting<T>(key, defaultValue: T): T`

The tests in `src/settings.test.ts` verify the intended precedence and default-value behavior.

Validation run:

- `pnpm vitest run src/settings.test.ts`
- `pnpm run compile`
