---
# opilot-j7cp
title: Library recency sort should fetch newest-first from ollama.com
status: completed
type: fix
priority: medium
created_at: 2026-03-05T22:03:06Z
updated_at: 2026-03-06T06:48:17Z
---

## Todo

- [x] Write failing test: recency mode must fetch `?sort=newest` URL
- [x] `fetchLibraryModelNames` accepts `sortMode` and uses correct URL
- [x] `setSortMode` calls `refresh()` to bust cache on mode change
- [x] `refresh()` also nulls `loadPromise` + increments `cacheGeneration` to prevent stale write-back
- [x] `getLibraryModels` passes `sortMode` to fetch and guards cache write with generation check
- [x] Run tests green
- [x] Commit and push
