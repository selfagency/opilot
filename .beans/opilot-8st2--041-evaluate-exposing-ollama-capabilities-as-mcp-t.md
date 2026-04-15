---
# opilot-8st2
title: 041 Evaluate exposing Ollama capabilities as MCP tools
status: completed
type: task
priority: low
created_at: 2026-04-14T21:40:18Z
updated_at: 2026-04-15T08:06:00Z
parent: opilot-itbr
---

Source issue 041 from `docs/plans/remediation-plan.md`.

## Summary

The review identifies MCP exposure as an ecosystem-alignment opportunity for Ollama capabilities such as model management or generation.

## Files

- potential new MCP-related modules or manifest changes
- existing tooling and command surfaces used as references

## Remediation Goal

Assess whether MCP exposure is worthwhile and realistic for this extension without committing prematurely to an unnecessary subsystem.

## Todo

- [x] Review the current capability surface that could sensibly be exposed through MCP
- [x] Identify likely user value, implementation cost, and maintenance burden
- [x] Determine whether MCP exposure should be additive, experimental, or deferred
- [x] Capture any architectural constraints or security concerns discovered during evaluation
- [x] Publish a recommendation and next-step proposal

## Summary of Changes

Evaluation decision: **defer MCP exposure** for now.

Rationale:

- Current extension value is centered on VS Code chat/provider/sidebar flows; adding MCP exposure now introduces substantial API hardening and maintenance burden.
- Safe MCP exposure would require explicit capability boundaries, auth/scope controls, and long-term compatibility commitments not currently in scope for this remediation pass.
- Revisit when there is concrete user demand for external orchestration of model-management workflows.

Decision recorded in this bean for durable project tracking.

Validation run:

- `pnpm run compile`
