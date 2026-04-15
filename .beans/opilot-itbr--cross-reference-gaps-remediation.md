---
# opilot-itbr
title: Cross-reference gaps remediation
status: completed
type: epic
priority: low
created_at: 2026-04-14T21:37:16Z
updated_at: 2026-04-15T13:34:17Z
parent: opilot-fu6s
---

Track the alignment opportunities identified by comparing the codebase to VS Code AI and Ollama documentation.

## Included Findings

- 034 Tool naming convention alignment
- 035 Better `modelDescription` content for tools
- 036 Broader `canBeReferencedInPrompt` enablement
- 037 Chat participant disambiguation examples
- 038 Chat location awareness
- 039 Silent mode handling in `provideLanguageModelChatInformation`
- 040 Evaluate adopting `@vscode/prompt-tsx`
- 041 Evaluate exposing capabilities as MCP tools
- 042 Abort semantics and per-request client isolation
- 043 Mid-stream OpenAI-compatible error parsing

## Todo

- [x] Review all documentation alignment gaps as a group
- [x] Create child issues for each cross-reference finding
- [x] Separate immediate wins from larger exploratory work
- [x] Verify the epic covers all documentation-alignment findings from the plan

## Summary of Changes

Completed child findings:

- `opilot-5cdc` (034): tool naming surface audited; no contributed `languageModelTools` surface to rename.
- `opilot-5p63` (035): tool `modelDescription` surface audited; no contributed tool metadata surface to adjust.
- `opilot-x178` (036): `canBeReferencedInPrompt` expansion assessed as non-applicable in current manifest state.
- `opilot-93t0` (037): disambiguation examples completed via overlap with issue 026.
- `opilot-o6ou` (038): location-aware branching evaluated; current behavior intentionally remains location-agnostic.
- `opilot-woor` (039): silent-mode discovery behavior verified as non-interactive.
- `opilot-yqdn` (040): prompt-tsx evaluation completed with defer decision.
- `opilot-8st2` (041): MCP exposure evaluation completed with defer decision.
- `opilot-8j4e` (042): abort semantics and per-request client isolation explicitly documented in provider flow.
- `opilot-3tlg` (043): mid-stream OpenAI-compatible error payload detection implemented and tested.
