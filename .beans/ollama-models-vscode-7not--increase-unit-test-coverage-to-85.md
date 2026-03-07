---
# ollama-models-vscode-7not
title: Increase unit test coverage to 85%
status: in-progress
type: feature
priority: medium
created_at: 2026-03-07T16:08:40Z
updated_at: 2026-03-07T20:00:00Z
branch: feat/7not-increase-unit-test-coverage-to-85
---

## Todo

- [x] Add `src/client.test.ts` covering `OllamaClient` constructor, `setAuthToken`, list/chat/embed/pull
- [x] Add `src/modelfiles.test.ts` covering `ModelfilesProvider` CRUD and error paths
- [x] Add `src/provider.test.ts` `setAuthToken` and capability tests
- [x] Add `src/extension.test.ts` tool loop and logger tests
- [x] Fix `src/sidebar.test.ts` — remove deleted `setSortMode`/`handleSortLibraryByRecency`/`handleSortLibraryByName` tests; fix grouping navigation for family-tree layout; fix `LibraryModelsProvider` constructor calls; fix `handleStartCloudModel` mocks

