---
# opilot-qimd
title: 'Phase 3 completion: pull progress & model capability badges'
status: completed
type: feature
priority: high
created_at: 2026-03-05T20:06:05Z
updated_at: 2026-03-05T20:06:37Z
branch: feat/qimd-pull-progress-model-capabilities
---

Complete the remaining Phase 3 sidebar items: streaming pull progress indicator and model capability badges.

## Todo

- [x] Extract shared `pullModelWithProgress` helper in sidebar.ts
- [x] Update `handlePullModel` to use streaming progress
- [x] Update `handlePullModelFromLibrary` to be async and show streaming progress
- [x] Import `fetchModelCapabilities` in sidebar.ts and add async badge display
- [x] Update `withProgress` mock in sidebar.test.ts to pass (progress, token)
- [x] Update pull mock to return an async iterable
- [x] Add tests for pull progress reporting and capability badges
- [x] Run all tests and verify they pass

## Summary of Changes

- Added `pullModelWithProgress()` shared async helper using `window.withProgress` with `ProgressLocation.Notification`; streams pull chunks and reports `${pct}% (completedMb / totalMb MB)` or status text
- `handlePullModel` and `handlePullModelFromLibrary` rewritten as `async Promise<void>` delegating to the helper
- `getLocalModels()` now fires `fetchModelCapabilities()` async for each item and appends `[tools]`/`[vision]` badges to `item.description`, updating the tree via `treeChangeEmitter.fire(item)`
- 4 new pull-progress tests + 1 capability badge test; total 113 tests passing (up from 109)
- Clean TypeScript build: extension.js 47.37 KB
