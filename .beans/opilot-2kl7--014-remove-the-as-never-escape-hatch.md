---
# opilot-2kl7
title: 014 Remove the as never escape hatch
status: todo
type: task
priority: low
created_at: 2026-04-14T21:39:09Z
updated_at: 2026-04-14T21:39:09Z
parent: opilot-qi3q
id: opilot-2kl7
---

Source issue 014 from `docs/plans/remediation-plan.md`.

## Summary

An `as never` cast is suppressing type checking, which hides a mismatch rather than solving it.

## Files

- `src/extension.ts`

## Remediation Goal

Model the actual type relationship correctly so the compiler can validate the code without forced impossibilities.

## Todo

- [ ] Locate the `as never` cast and document what type mismatch it is masking
- [ ] Refactor the surrounding types or control flow to remove the cast
- [ ] Add or update tests if the fix changes behavior-sensitive code paths
- [ ] Confirm the compiler now enforces the intended type guarantees
- [ ] Verify no new escape-hatch casts were introduced nearby
