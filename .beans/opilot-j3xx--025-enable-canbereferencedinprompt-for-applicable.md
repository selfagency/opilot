---
# opilot-j3xx
title: 025 Enable canBeReferencedInPrompt for applicable tools
status: todo
type: task
priority: low
created_at: 2026-04-14T21:39:33Z
updated_at: 2026-04-14T21:39:33Z
parent: opilot-9ycj
id: opilot-j3xx
---

Source issue 025 from `docs/plans/remediation-plan.md`.

## Summary

Not all tools that should be directly referenceable expose `canBeReferencedInPrompt`, reducing discoverability in chat.

## Files

- `package.json`
- any supporting tool contribution helpers

## Remediation Goal

Enable prompt references on the right tools while avoiding noisy or misleading exposure for inappropriate ones.

## Todo

- [ ] Audit current tool contributions and identify which ones should support `#tool` references
- [ ] Update the applicable manifest entries consistently
- [ ] Verify tool descriptions still make sense when exposed directly in prompts
- [ ] Confirm no unsuitable tools are exposed accidentally
- [ ] Validate the extension manifest remains well-formed after the update
