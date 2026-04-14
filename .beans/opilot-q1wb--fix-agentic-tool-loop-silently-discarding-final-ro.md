---
id: opilot-q1wb
title: Fix agentic tool loop silently discarding final-round text when MAX_TOOL_ROUNDS exhausted
status: completed
type: fix
---

ty: normal
created_at: 2026-03-07T18:38:10Z
updated_at: 2026-03-07T18:42:45Z
id: opilot-q1wb

---

When the VS Code LM tool loop exhausts all MAX_TOOL_ROUNDS iterations (11 rounds, 0–10), the loop exits naturally without hitting the `break` branch that flushes `assistantTextParts`. Any text the model produced in the final round is silently discarded and never rendered via `stream.markdown()`.

## Root Cause

In `handleChatRequest` (`src/extension.ts`), `assistantTextParts` is only flushed inside the `break` branch (`pendingToolCalls.length === 0`). If the loop runs all 11 rounds and each round has pending tool calls, the loop exits by falling off the end — the last round's text is lost.

## Todo

- [x] Write failing test: model always returns tool calls for MAX_TOOL_ROUNDS+1 rounds — verify final-round text is still rendered
- [x] Declare `lastRoundTextParts` outside the for loop, assign in each iteration, clear when flushed in break branch
- [x] After the for loop, flush `lastRoundTextParts` unconditionally
- [x] Compile passes, all tests pass

## Summary of Changes

- Added `lastRoundTextParts` variable outside the `for` loop
- Each iteration assigns `lastRoundTextParts = assistantTextParts`
- The `break` path clears `lastRoundTextParts = []` to avoid double-flush
- After the loop, flush any remaining `lastRoundTextParts` via `stream.markdown()`
- Commit: `3f30404b40ca2152b670b79016778f1ca973beeb`, branch: `fix/q1wb-tool-loop-flush-final-round-text`
