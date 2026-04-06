---
# ollama-models-vscode-eig7
title: Add MSW for centralised HTTP mocking in unit tests
status: completed
type: feat
priority: high
branch: feat/ollama-models-vscode-eig7-add-msw-http-mocking
pr: 86
created_at: 2026-04-06T15:11:31Z
updated_at: 2026-04-06T15:11:31Z
---

## Problem

The codebase has no centralised HTTP mocking layer. `openaiCompat.ts` exposes a `fetchFn` injection escape hatch solely for testability, and `sidebar.ts` has 7 raw `fetch()` calls with zero unit test coverage. MSW's Node.js `setupServer` intercepts at the transport level, eliminating the need for manual injection and enabling proper sidebar coverage.

## Todo

- [x] Create bean + branch
- [x] Install `msw` dev dependency
- [x] Create `src/mocks/handlers.ts` (all OpenAI-compat + ollama.com handlers)
- [x] Create `src/mocks/node.ts` (`setupServer` export)
- [x] Create `src/test/setup.ts` (Vitest `beforeAll`/`afterEach`/`afterAll`)
- [x] Update `vitest.config.js` to add `setupFiles`
- [x] Remove `fetchFn` from `openaiCompat.ts`
- [x] Refactor `openaiCompat.test.ts` to use MSW
- [x] Add sidebar fetch coverage in `sidebar.test.ts`

## Summary of Changes

- Installed MSW 2.x as dev dependency
- `src/mocks/handlers.ts` — centralized handlers for ollama.com HTML pages, `/api/tags` JSON, and local `/v1/chat/completions` (streaming + non-streaming)
- `src/mocks/node.ts` — `setupServer` export
- `src/test/setup.ts` — global Vitest lifecycle hooks
- `vitest.config.js` — added `setupFiles` + `unstubGlobals: true`
- Removed `fetchFn` injection from `openaiCompat.ts`; migrated `openaiCompat.test.ts` to MSW
- Added 11 new MSW-based HTTP tests in `sidebar.test.ts` covering `assertHtmlContentType`, `LibraryModelsProvider`, `CloudModelsProvider`, and `fetchModelPagePreview`
- All 633 tests pass
- [ ] Run `task precommit`, fix any issues
- [ ] Commit and push, open PR
