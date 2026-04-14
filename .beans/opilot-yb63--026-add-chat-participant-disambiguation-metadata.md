---
# opilot-yb63
title: 026 Add chat participant disambiguation metadata
status: todo
type: task
priority: low
created_at: 2026-04-14T21:39:33Z
updated_at: 2026-04-14T21:39:33Z
parent: opilot-9ycj
id: opilot-yb63
---

Source issue 026 from `docs/plans/remediation-plan.md`.

## Summary

The `@ollama` chat participant lacks disambiguation configuration, which limits VS Code's ability to auto-route relevant prompts.

## Files

- `package.json`
- any participant registration helpers if needed

## Remediation Goal

Improve participant discoverability and routing by adding a useful category, description, and examples.

## Todo

- [ ] Review the current chat participant contribution in `package.json`
- [ ] Draft disambiguation metadata that accurately reflects the participant's strengths
- [ ] Add examples that help VS Code route the right requests automatically
- [ ] Verify the wording is specific enough to avoid over-routing unrelated prompts
- [ ] Validate the manifest contribution and resulting participant behavior
