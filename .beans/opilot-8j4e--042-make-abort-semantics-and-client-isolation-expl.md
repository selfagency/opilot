---
# opilot-8j4e
title: 042 Make abort semantics and client isolation explicit
status: todo
type: task
priority: low
created_at: 2026-04-14T21:40:18Z
updated_at: 2026-04-14T21:40:18Z
parent: opilot-itbr
id: opilot-8j4e
---

Source issue 042 from `docs/plans/remediation-plan.md`.

## Summary

The Ollama SDK abort model can affect all streams on a client instance, so client isolation strategy should be explicit.

## Files

- `src/provider.ts`
- `src/client.ts`

## Remediation Goal

Choose and document a client lifecycle strategy that handles abort behavior safely and predictably.

## Todo

- [ ] Review how client instances are currently created, shared, and aborted
- [ ] Confirm the actual SDK abort semantics relevant to this extension
- [ ] Decide whether per-request clients or another isolation strategy is the safest approach
- [ ] Update implementation and tests if a lifecycle change is needed
- [ ] Document the rationale so future maintainers do not reintroduce unsafe sharing
