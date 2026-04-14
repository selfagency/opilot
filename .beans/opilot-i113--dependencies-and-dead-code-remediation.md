---
# opilot-i113
title: Dependencies and dead-code remediation
status: todo
type: epic
priority: low
created_at: 2026-04-14T21:37:16Z
updated_at: 2026-04-14T21:39:39Z
---

Remove dead or stale dependency-related artifacts so the repository stays easier to maintain.

## Included Findings

- 027 Dead type declaration for unused package in `saxophone.d.ts`

## Todo

- [ ] Confirm the dead artifact is unused everywhere
- [ ] Create child issue for the dependency cleanup
- [ ] Verify removal does not affect build or test behavior
- [ ] Verify the epic covers all dependency findings from the plan
