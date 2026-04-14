---
# opilot-5o5n
title: 005 Harden direct config file writes against races
status: todo
type: bug
priority: normal
created_at: 2026-04-14T21:38:28Z
updated_at: 2026-04-14T21:38:28Z
parent: opilot-yva4
id: opilot-5o5n
---

Source issue 005 from `docs/plans/remediation-plan.md`.

## Summary

`removeBuiltInOllamaFromChatLanguageModels` performs an unlocked read-modify-write cycle on VS Code configuration files, which risks lost updates under concurrent access.

## Files

- `src/extension.ts`

## Remediation Goal

Make the configuration update logic resilient to concurrent edits by adding safe retry or change-detection behavior.

## Todo

- [ ] Review the current file-mutation flow and confirm where race windows exist
- [ ] Choose a safe strategy such as compare-and-retry or API-based mutation where available
- [ ] Implement the hardened write path with bounded retry behavior
- [ ] Add tests that cover unchanged and concurrently changed file scenarios
- [ ] Verify the function preserves user configuration while removing only the intended entries
