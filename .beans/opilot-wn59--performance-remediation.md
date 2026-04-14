---
# opilot-wn59
title: Performance remediation
status: todo
type: epic
priority: normal
created_at: 2026-04-14T21:37:16Z
updated_at: 2026-04-14T21:39:39Z
---

Address low-severity performance inefficiencies called out in the review so hot paths stay lean and predictable.

## Included Findings

- 016 Repeated `getSetting()` calls not cached per request
- 017 Sidebar tree refresh fires on every tooltip update
- 018 Worst-case O(n^2) repetition detection in `src/contextUtils.ts`
- 019 New Ollama client created per request in `src/provider.ts`

## Todo

- [ ] Review the measured and suspected performance issues in scope
- [ ] Create child issues for each performance finding
- [ ] Flag issues that need benchmarking before optimization
- [ ] Verify the epic covers all performance findings from the plan
