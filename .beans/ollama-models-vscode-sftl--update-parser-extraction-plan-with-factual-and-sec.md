---
# ollama-models-vscode-sftl
title: Update parser extraction plan with factual and security corrections
status: completed
type: task
priority: high
created_at: 2026-03-11T16:26:36Z
updated_at: 2026-03-11T16:34:56Z
---

## Context

Apply review feedback to docs/plans/parser-extraction.plan.md for factual accuracy, feature completeness, best practices, and security.

## Todo

- [x] Correct API terminology and claims (OpenAI/Anthropic/LangChain citations)
- [x] Add explicit security limits and threat-model guidance
- [x] Add validation-engine contract and streaming edge-case behavior
- [x] Add acceptance criteria and rollout/rollback section
- [x] Final pass for coherence and non-contradiction
- [x] Editorial cleanup to reduce repetition and improve flow
- [x] Standardize citation tone phrasing across sections

## Summary of Changes

- Updated OpenAI terminology to use Responses API `text.format` / strict tool schemas where relevant.
- Clarified Anthropic helper inspirations and modernized LangChain citation wording.
- Added a validation engine contract section with optional validator adapter model.
- Expanded security/privacy section with threat model, hard limits, and fail-closed behavior.
- Added explicit acceptance criteria, migration gates, and rollback plan.
- Performed concise editorial pass: merged repetitive Section 6 subsections into a single "Streaming/event and composition refinements" subsection and fixed list formatting consistency in Resolved Decisions.
- Standardized citation language to consistent "influenced by / draws on" style for smoother tone and readability.
