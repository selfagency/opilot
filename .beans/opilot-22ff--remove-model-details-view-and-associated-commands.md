---
# opilot-22ff
title: Remove model details view and associated commands
status: completed
type: fix
priority: medium
created_at: 2026-03-05T22:02:46Z
updated_at: 2026-03-06T06:12:42Z
branch: fix/22ff-remove-model-details-view
pr: https://github.com/selfagency/ollama-copilot/pull/12
---

## Todo

- [x] Write failing tests confirming removal
- [x] Remove `ollama-model-preview` view from `package.json`
- [x] Remove `previewLibraryModel` command from `package.json`
- [x] Remove `previewLibraryModel` menu entry from `package.json`
- [x] Remove `ModelPreviewViewProvider` class from `sidebar.ts`
- [x] Remove `handleShowModelDetails` function from `sidebar.ts`
- [x] Remove `WebviewView`/`WebviewViewProvider` imports from `sidebar.ts`
- [x] Remove `previewProvider` instantiation and registrations from `registerSidebar()`
- [x] Remove `handleShowModelDetails` tests from `sidebar.test.ts`
- [x] Run full test suite green
- [x] Commit and push

## Summary of Changes

Removed the `ollama-model-preview` webview view panel and all associated machinery (`ModelPreviewViewProvider`, `handleShowModelDetails`, `previewLibraryModel` command). `fetchModelPagePreview` was kept as it is still used for tooltip descriptions on local and library model tree items. Three regression tests guard against re-introduction.
