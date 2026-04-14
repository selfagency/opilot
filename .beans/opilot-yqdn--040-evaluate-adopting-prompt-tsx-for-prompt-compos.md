---
# opilot-yqdn
title: 040 Evaluate adopting prompt tsx for prompt composition
status: todo
type: task
priority: low
created_at: 2026-04-14T21:40:18Z
updated_at: 2026-04-14T21:40:18Z
parent: opilot-itbr
id: opilot-yqdn
---

Source issue 040 from `docs/plans/remediation-plan.md`.

## Summary

The review suggests evaluating `@vscode/prompt-tsx` to improve prompt composition, prioritization, and token-budget management.

## Files

- potential new prompt-composition modules
- current prompt-building code in `src/extension.ts` and `src/provider.ts`

## Remediation Goal

Run an explicit evaluation rather than leaving prompt-tsx as an untracked architectural maybe.

## Todo

- [ ] Inventory current prompt construction paths and pain points
- [ ] Compare those needs against what `@vscode/prompt-tsx` would actually solve
- [ ] Produce a recommendation to adopt, defer, or reject with reasons
- [ ] If adoption looks viable, outline the migration scope and risks
- [ ] Record the decision in a durable location such as repo docs or an ADR
