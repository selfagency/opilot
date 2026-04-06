---
# ollama-models-vscode-eig7
title: Add MSW for centralised HTTP mocking in unit tests
status: in-progress
type: feat
priority: high
created_at: 2026-04-06T15:11:31Z
updated_at: 2026-04-06T15:11:31Z
---

## Problem

The codebase has no centralised HTTP mocking layer. `openaiCompat.ts` exposes a `fetchFn` injection escape hatch solely for testability, and `sidebar.ts` has 7 raw `fetch()` calls with zero unit test coverage. MSW's Node.js `setupServer` intercepts at the transport level, eliminating the need for manual injection and enabling proper sidebar coverage.

## Todo

- [ ] Create bean + branch
- [ ] Install `msw` dev dependency
- [ ] Create `src/mocks/handlers.ts` (all OpenAI-compat + ollama.com handlers)
- [ ] Create `src/mocks/node.ts` (`setupServer` export)
- [ ] Create `src/test/setup.ts` (Vitest `beforeAll`/`afterEach`/`afterAll`)
- [ ] Update `vitest.config.js` to add `setupFiles`
- [ ] Remove `fetchFn` from `openaiCompat.ts`
- [ ] Refactor `openaiCompat.test.ts` to use MSW
- [ ] Add sidebar fetch coverage in `sidebar.test.ts`
- [ ] Run `task precommit`, fix any issues
- [ ] Commit and push, open PR
