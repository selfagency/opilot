---
# ollama-models-vscode-h9yi
title: Fix modelfiles view crash on refresh (iconPath TypeError)
status: todo
type: bug
priority: high
created_at: 2026-03-07T17:17:20Z
updated_at: 2026-03-07T17:19:46Z
---

After creating a modelfile, the modelfiles view crashes on refresh with `TypeError: Cannot read properties of undefined reading '0'`.

## Root Cause

`ModelfileItem.iconPath = { id: 'file-code' } as unknown as vscode.ThemeIcon` is not a real ThemeIcon instance. VS Code internals call `.file[0]` on it and crash.

## Todo

- [ ] Add `createThemeIcon(id)` helper function to `src/modelfiles.ts` (same pattern as sidebar.ts)
- [ ] Replace `this.iconPath = { id: 'file-code' } as unknown as vscode.ThemeIcon` with `this.iconPath = createThemeIcon('file-code')` in `ModelfileItem` constructor (~line 109)
- [ ] Run `pnpm run compile` to verify TypeScript passes
- [ ] Run `pnpm run test` to verify unit tests still pass
