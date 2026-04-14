---
# opilot-bcub
title: 020 Clean up legacy settings after successful migration
status: todo
type: task
priority: normal
created_at: 2026-04-14T21:39:09Z
updated_at: 2026-04-14T21:39:09Z
parent: opilot-dfc1
id: opilot-bcub
---

Source issue 020 from `docs/plans/remediation-plan.md`.

## Summary

Legacy settings remain after migration, which can keep the configuration surface messy and harder to reason about.

## Files

- `src/settings.ts`

## Remediation Goal

Remove or retire legacy settings at the right time without surprising existing users or breaking migration safety.

## Todo

- [ ] Review the current migration flow and confirm when cleanup is safe
- [ ] Define the conditions that prove a user has migrated successfully
- [ ] Implement legacy cleanup with clear safeguards against accidental data loss
- [ ] Add tests for first-run, migrated-user, and partially migrated scenarios
- [ ] Verify settings behavior remains stable across extension upgrades
