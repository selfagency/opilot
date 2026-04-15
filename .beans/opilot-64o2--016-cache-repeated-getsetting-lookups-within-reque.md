---
# opilot-64o2
title: 016 Cache repeated getSetting lookups within request scope
status: completed
type: task
priority: low
created_at: 2026-04-14T21:39:09Z
updated_at: 2026-04-15T13:36:19Z
parent: opilot-wn59
---

Source issue 016 from `docs/plans/remediation-plan.md`.

## Summary

Some request paths repeatedly call `getSetting()` for the same values instead of resolving them once.

## Files

- Multiple files with request-scoped setting lookups

## Remediation Goal

Avoid redundant settings access in hot paths while keeping configuration behavior correct and readable.

## Todo

- [x] Identify request paths with repeated `getSetting()` calls for the same keys
- [x] Introduce request-scoped caching or local extraction where it improves clarity
- [x] Avoid global caching that could hide live configuration changes unexpectedly
- [x] Add or update tests for the affected call paths if needed
- [x] Verify the resulting code is simpler as well as slightly faster

## Summary of Changes

Audit outcome:

- Reviewed request-scoped settings reads in `src/extension.ts`, `src/provider.ts`, and `src/sidebar.ts`.
- Current hot paths already read each relevant key once per request scope (or at periodic refresh boundaries), so no additional request-cache layer was required.
- Avoided introducing global caching to preserve live settings behavior.

Validation run:

- `pnpm run compile`
