---
# opilot-9qvz
title: 019 Reuse or isolate Ollama clients intentionally in provider flows
status: todo
type: task
priority: low
created_at: 2026-04-14T21:39:09Z
updated_at: 2026-04-14T21:39:09Z
parent: opilot-wn59
id: opilot-9qvz
---

Source issue 019 from `docs/plans/remediation-plan.md`.

## Summary

`src/provider.ts` creates a new Ollama client per request. This may be acceptable, but the review flagged it as a possible performance concern.

## Files

- `src/provider.ts`
- `src/client.ts`

## Remediation Goal

Make client lifecycle decisions explicit so the code balances performance, cancellation safety, and simplicity.

## Todo

- [ ] Review current client creation frequency and the reasons behind it
- [ ] Evaluate whether per-request creation is intentional for isolation or an avoidable cost
- [ ] If needed, introduce a safer reuse strategy that preserves abort semantics
- [ ] Add tests for lifecycle-sensitive behavior such as cancellation and retries
- [ ] Document the chosen trade-off in code or repo docs if it is non-obvious
