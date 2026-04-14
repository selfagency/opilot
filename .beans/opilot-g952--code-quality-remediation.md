---
# opilot-g952
title: Code quality remediation
status: todo
type: epic
priority: normal
created_at: 2026-04-14T21:37:16Z
updated_at: 2026-04-14T21:43:49Z
parent: opilot-fu6s
---

Clean up lower-severity maintainability and API-shape issues not already captured elsewhere.

## Included Findings

- 031 `getSetting` return type API could be clearer
- 032 Unused `saxophone.d.ts` type declaration file
- 033 `src/extension.ts` file size exceeds maintainable threshold

## Todo

- [ ] Review code quality findings and overlap with other epics
- [ ] Create child issues for each code-quality finding
- [ ] Avoid duplicating work already tracked under architecture or dependencies
- [ ] Verify the epic covers all code-quality findings from the plan
