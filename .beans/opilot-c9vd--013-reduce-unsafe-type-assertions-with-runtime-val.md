---
# opilot-c9vd
title: 013 Reduce unsafe type assertions with runtime validation
status: completed
type: task
priority: normal
created_at: 2026-04-14T21:39:09Z
updated_at: 2026-04-15T13:36:19Z
parent: opilot-qi3q
---

Source issue 013 from `docs/plans/remediation-plan.md`.

## Summary

Several modules rely heavily on `as` assertions without validating the runtime shape first, weakening type safety and making failures less predictable.

## Files

- Multiple files identified during implementation

## Remediation Goal

Replace assertion-heavy boundaries with narrow validation helpers or better-typed abstractions where the runtime shape is not guaranteed.

## Todo

- [x] Inventory the highest-risk `as` assertions in production paths
- [x] Group them by boundary type such as config, API response, or VS Code payload
- [x] Introduce runtime checks or typed helpers for the riskiest cases
- [x] Add tests for malformed or partial input shapes
- [x] Verify the resulting code reduces unsafe assertions without excessive noise

## Summary of Changes

- Replaced assertion-heavy record reads in production paths with narrow runtime field validators:
  - `src/statusBar.ts`: `checkOllamaHealth` now uses guarded `getNumberField(...)` lookups for `size` and `size_vram`.
  - `src/sidebar.ts`: local-running process parsing now uses `getNumberField(...)`/`getStringField(...)` helpers instead of raw record casts.
- Added regression coverage in `src/statusBar.test.ts` for malformed numeric fields, ensuring safe fallback to `0`.

Validation run:

- `pnpm vitest run src/statusBar.test.ts src/sidebar.test.ts src/sidebar.utils.test.ts`
- `pnpm run compile`
