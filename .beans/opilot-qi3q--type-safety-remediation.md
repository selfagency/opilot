---
# opilot-qi3q
title: Type safety remediation
status: todo
type: epic
priority: normal
created_at: 2026-04-14T21:37:16Z
updated_at: 2026-04-14T21:39:38Z
---

Tighten runtime and compile-time safety where type assertions currently suppress useful guarantees.

## Included Findings

- 013 Excessive `as` assertions without runtime validation
- 014 `as never` cast suppresses type checking
- 015 Inconsistent import style for VS Code types

## Todo

- [ ] Review assertion-heavy code paths and affected modules
- [ ] Create child issues for each type-safety finding
- [ ] Separate correctness work from style-only cleanup where helpful
- [ ] Verify the epic covers all type-safety findings from the plan
