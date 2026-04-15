---
# opilot-qi3q
title: Type safety remediation
status: completed
type: epic
priority: normal
created_at: 2026-04-14T21:37:16Z
updated_at: 2026-04-15T13:34:17Z
parent: opilot-fu6s
---

Tighten runtime and compile-time safety where type assertions currently suppress useful guarantees.

## Included Findings

- 013 Excessive `as` assertions without runtime validation
- 014 `as never` cast suppresses type checking
- 015 Inconsistent import style for VS Code types

## Todo

- [x] Review assertion-heavy code paths and affected modules
- [x] Create child issues for each type-safety finding
- [x] Separate correctness work from style-only cleanup where helpful
- [x] Verify the epic covers all type-safety findings from the plan

## Summary of Changes

Completed child findings:

- `opilot-c9vd` (013): replaced assertion-heavy production field reads with runtime-validated helpers and added malformed-shape tests.
- `opilot-2kl7` (014): removed production `as never` escape hatch and replaced with explicit typed tool-result message shape.
- `opilot-r9qv` (015): standardized import-style policy decision for VS Code imports with minimal churn.

All slices validated with targeted tests and compile checks.
