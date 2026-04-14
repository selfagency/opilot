---
# opilot-k68q
title: Refactor `as any` type escaping in test mocks
status: completed
type: task
priority: normal
created_at: 2026-03-08T16:39:52Z
updated_at: 2026-03-08T17:25:06Z
id: opilot-k68q
---

Replace `as any` type assertions in test mocks with properly typed alternatives or `as unknown as T` casts.

## Context

Large portions of `src/sidebar.test.ts` and `src/provider.test.ts` use `as any` to silence TypeScript when constructing VS Code mock objects. This bypasses type safety and can hide interface mismatches when the API changes.

## Todo

- [ ] Audit all `as any` usages in `src/sidebar.test.ts` (15+ occurrences)
- [ ] Audit all `as any` usages in `src/provider.test.ts`
- [ ] Replace with typed mocks where possible (e.g., `Partial<TreeItem>` cast via `as unknown as TreeItem`)
- [ ] Ensure no test regressions (`task unit-tests`)

## Files

- `src/sidebar.test.ts`
- `src/provider.test.ts`
