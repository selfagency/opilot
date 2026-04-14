---
# opilot-blpq
title: Test cloud rescue logic and model cache race conditions
status: completed
type: task
priority: normal
created_at: 2026-03-08T16:40:05Z
updated_at: 2026-03-08T17:29:32Z
id: opilot-blpq
---

Add missing test coverage for the cloud-rescue fallback logic and concurrent model-cache access in `src/provider.ts`.

## Context

The cloud rescue path (falling back to cloud models when local Ollama is unreachable) has a single smoke test but lacks permutation coverage (e.g., partial failure, retry exhaustion, model list ordering). The model cache has no tests for concurrent `refresh()` calls or stale-while-revalidate scenarios, which could hide race conditions.

## Todo

- [ ] Add permutation tests for cloud rescue logic in `src/provider.test.ts` (partial failure, retry exhaustion, ordering)
- [ ] Add concurrent-fetch / race condition tests for the model cache in `src/provider.test.ts`
- [ ] Run `task unit-test-coverage` and verify coverage improves for `src/provider.ts`

## Files

- `src/provider.test.ts`
- `src/provider.ts` (reference only)
