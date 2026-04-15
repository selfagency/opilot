---
# opilot-9ycj
title: VS Code best-practices remediation
status: completed
type: epic
priority: normal
created_at: 2026-04-14T21:37:16Z
updated_at: 2026-04-15T00:56:00Z
parent: opilot-fu6s
---

Align the extension with current VS Code platform guidance where implementation gaps are already known.

## Included Findings

- 024 Deprecated `createStatusBarItem` overload used
- 025 `canBeReferencedInPrompt` not set on all applicable tools
- 026 No disambiguation config for the chat participant

## Todo

- [x] Review current VS Code API usage and extension manifest contributions
- [x] Create child issues for each platform-alignment finding
- [x] Confirm behavior changes remain backward compatible
- [x] Verify the epic covers all VS Code best-practice findings from the plan

## Summary of Changes

Completed child findings:

- `opilot-e176` (024): migrated status bar creation to non-deprecated API signature.
- `opilot-j3xx` (025): audited `canBeReferencedInPrompt` applicability and closed as not currently applicable (no `languageModelTools` manifest contributions).
- `opilot-yb63` (026): added chat participant disambiguation metadata (category/description/examples).

Validation for child changes included targeted tests and compile checks per issue commit.
