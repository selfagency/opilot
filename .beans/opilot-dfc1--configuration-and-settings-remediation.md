---
# opilot-dfc1
title: Configuration and settings remediation
status: todo
type: epic
priority: normal
created_at: 2026-04-14T21:37:16Z
updated_at: 2026-04-14T21:43:48Z
parent: opilot-fu6s
---

Clean up configuration migration and stale settings declarations so settings behavior remains predictable for users.

## Included Findings

- 020 Legacy settings not cleaned up after migration
- 021 Deprecated `ollama.*` settings still declared in `package.json`

## Todo

- [ ] Review migration behavior and remaining legacy declarations
- [ ] Create child issues for each configuration finding
- [ ] Confirm cleanup preserves compatibility for existing users
- [ ] Verify the epic covers all configuration findings from the plan
