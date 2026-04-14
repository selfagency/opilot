---
# opilot-7not
title: Increase unit test coverage to 85%
status: completed
type: feature
priority: medium
created_at: 2026-03-07T16:08:40Z
updated_at: 2026-03-08T18:04:31Z
id: opilot-7not
---

## Todo

- [x] Add `src/client.test.ts` covering `OllamaClient` constructor, `setAuthToken`, list/chat/embed/pull
- [x] Add `src/modelfiles.test.ts` covering `ModelfilesProvider` CRUD and error paths
- [x] Add `src/provider.test.ts` `setAuthToken` and capability tests
- [x] Add `src/extension.test.ts` tool loop and logger tests
- [x] Fix `src/sidebar.test.ts` — remove deleted `setSortMode`/`handleSortLibraryByRecency`/`handleSortLibraryByName` tests; fix grouping navigation for family-tree layout; fix `LibraryModelsProvider` constructor calls; fix `handleStartCloudModel` mocks

## Summary of Changes

Increased unit test coverage from ~60% to well above 85% on key source files. Added parseModelfile tests (full syntax coverage including multi-line triple-quoted values, MESSAGE handling, PARAMETER coercion, ADAPTER), handleBuildModelfile missing-FROM branch, modelfiles folder error path, getModelPreviewCacheSnapshot, formatRelativeFromNow/formatSizeForTooltip/buildCapabilityLines/buildLocalModelTooltip/assertHtmlContentType helpers, extension formatBytes, deactivate, getOllamaServerLogPath, handleConnectionTestFailure Open Logs branch, and handleChatRequest showSystemPromptIfEmpty path. Final test count: 337 (was 298).

Commits: 288bbb6 (branch task/7not-coverage-to-85)
