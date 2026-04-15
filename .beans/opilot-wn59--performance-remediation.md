---
# opilot-wn59
title: Performance remediation
status: completed
type: epic
priority: normal
created_at: 2026-04-14T21:37:16Z
updated_at: 2026-04-15T09:03:00Z
parent: opilot-fu6s
---

Address low-severity performance inefficiencies called out in the review so hot paths stay lean and predictable.

## Included Findings

- 016 Repeated `getSetting()` calls not cached per request
- 017 Sidebar tree refresh fires on every tooltip update
- 018 Worst-case O(n^2) repetition detection in `src/contextUtils.ts`
- 019 New Ollama client created per request in `src/provider.ts`

## Todo

- [x] Review the measured and suspected performance issues in scope
- [x] Create child issues for each performance finding
- [x] Flag issues that need benchmarking before optimization
- [x] Verify the epic covers all performance findings from the plan

## Summary of Changes

Completed child findings:

- `opilot-64o2` (016): audited request-scope settings reads; no additional caching layer needed.
- `opilot-xdu8` (017): reduced tooltip-driven tree refresh churn by only firing item updates when tooltip text changes.
- `opilot-ih6a` (018): replaced worst-case repetition detection scan with rolling-hash based matching plus exact verification.
- `opilot-9qvz` (019): confirmed explicit per-request client isolation strategy for provider flows.

All slices were validated with targeted tests and compile checks before closure.
