---
# opilot-x178
title: 036 Expand canBeReferencedInPrompt coverage where appropriate
status: todo
type: task
priority: low
created_at: 2026-04-14T21:40:17Z
updated_at: 2026-04-14T21:40:17Z
parent: opilot-itbr
id: opilot-x178
---

Source issue 036 from `docs/plans/remediation-plan.md`.

## Summary

The review calls out broader `canBeReferencedInPrompt` usage as a documentation-alignment gap distinct from the explicit VS Code best-practice finding.

## Files

- `package.json`
- tool contribution definitions as needed

## Remediation Goal

Decide the intended prompt-reference surface deliberately and expand it only where it improves user experience.

## Todo

- [ ] Review overlap with issue 025 and define a single intended coverage policy
- [ ] Apply the policy consistently across eligible tools
- [ ] Verify prompt-reference behavior remains understandable to users
- [ ] Avoid exposing internal or confusing tools unnecessarily
- [ ] Confirm this alignment gap is fully closed by the resulting manifest changes
