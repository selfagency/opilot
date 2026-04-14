---
# opilot-1ubu
title: Architecture and duplication remediation
status: todo
type: epic
priority: high
created_at: 2026-04-14T21:37:16Z
updated_at: 2026-04-14T21:43:48Z
parent: opilot-fu6s
---

Address structural duplication and maintainability issues called out in the remediation plan.

## Included Findings

- 001 Six chat utility functions duplicated across `src/extension.ts` and `src/provider.ts`
- 002 `formatBytes()` duplicated across `src/extension.ts`, `src/statusBar.ts`, and `src/sidebar.ts`
- 003 `src/extension.ts` exceeds a maintainable size and mixes too many responsibilities

## Todo

- [ ] Review architecture findings and confirm target modules
- [ ] Create child issues for each architecture item
- [ ] Sequence child issues to minimize merge risk
- [ ] Verify the epic covers all architecture findings from the plan
