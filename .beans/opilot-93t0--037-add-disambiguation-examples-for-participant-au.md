---
# opilot-93t0
title: 037 Add disambiguation examples for participant auto routing
status: todo
type: task
priority: low
created_at: 2026-04-14T21:40:17Z
updated_at: 2026-04-14T21:40:17Z
parent: opilot-itbr
id: opilot-93t0
---

Source issue 037 from `docs/plans/remediation-plan.md`.

## Summary

The chat participant lacks disambiguation examples, limiting automatic routing quality.

## Files

- `package.json`

## Remediation Goal

Provide examples that help VS Code understand which prompts belong with the participant while minimizing false positives.

## Todo

- [ ] Review overlap with issue 026 and decide whether one change will satisfy both findings
- [ ] Draft representative examples based on actual participant capabilities
- [ ] Add the examples to the participant contribution metadata
- [ ] Validate the examples for clarity and routing specificity
- [ ] Confirm the change closes the documented gap without overfitting to narrow cases
