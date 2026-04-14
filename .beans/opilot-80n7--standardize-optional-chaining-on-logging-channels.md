---
# opilot-80n7
title: Standardize optional chaining on logging channels
status: completed
type: task
priority: low
created_at: 2026-03-08T16:40:28Z
updated_at: 2026-03-08T16:56:52Z
id: opilot-80n7
---

Remove superfluous optional chaining on the VS Code output channel and standardize logging call sites across `src/provider.ts` and `src/extension.ts`.

## Context

Several call sites use `outputChannel?.warn?.()` and similar double-optional-chaining despite the channel being a required, always-initialized dependency. This pattern suggests uncertainty about the API and can mask bugs. Three occurrences remain in `src/extension.ts` (lines ~472, 551, 585).

## Todo

- [ ] Audit all `?.warn?.` / `?.info?.` / `?.error?.` patterns in `src/extension.ts`
- [ ] Audit same patterns in `src/provider.ts`
- [ ] Replace with direct calls: `outputChannel.warn(...)` where the channel is guaranteed to exist
- [ ] If a channel may legitimately be absent, document why and keep one level of optional chaining
- [ ] Run `task check-types` and `task unit-tests` to verify no regressions

## Files

- `src/extension.ts`
- `src/provider.ts`
