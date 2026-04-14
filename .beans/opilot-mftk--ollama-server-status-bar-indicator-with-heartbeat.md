---
# opilot-mftk
title: ollama server status bar indicator with heartbeat
status: completed
type: task
priority: normal
created_at: 2026-03-10T02:47:58Z
updated_at: 2026-03-10T03:22:10Z
---

## Overview

Add a persistent VS Code status bar item that polls the Ollama server on a 30-second heartbeat and displays its health directly in the editor chrome. This is genuinely additive — Copilot has no visibility into whether the local Ollama process is running.

## Problem

Users have no way to know if the Ollama server is reachable without waiting for a request to fail. Errors only surface on first use, which is confusing.

## Proposed Solution

- **Status bar item** (`StatusBarAlignment.Right`, priority ~100) registered in `extension.ts` `activate()`
- **Icons:** `$(radio-tower)` + model count when healthy; `$(warning)` + "Ollama offline" when unreachable
- **Heartbeat:** reads `ollama.localModelRefreshInterval` (seconds) — same setting as sidebar refresh
- **Tooltip:** shows host URL, active model count, and last-checked timestamp
- **Click command:** `opilot.checkServerHealth` — triggers an immediate health check
- **Disposal:** heartbeat interval, config listener, and status bar item added to `context.subscriptions`

## Implementation Notes

- Reuse `getOllamaClient(context)` from `src/client.ts:39` — already handles auth + custom host
- Health check = `(await client.list()).models.length` — zero-cost if healthy
- Three visual states: `$(loading~spin) Ollama…` | `$(radio-tower) Ollama (N)` | `$(warning) Ollama offline`
- Debounce: requires 2 consecutive failures before showing offline state
- Re-schedules interval on `ollama.localModelRefreshInterval` config change

## Files Changed

- **`src/statusBar.ts`** (new) — `checkOllamaHealth`, `registerStatusBarHeartbeat`
- **`src/statusBar.test.ts`** (new) — 11 unit tests
- **`src/extension.ts`** — import + register in `activate()` subscriptions
- **`package.json`** — `opilot.checkServerHealth` command contribution

## Todo

- [x] Design health check helper function
- [x] Create and dispose status bar item in activate()
- [x] Implement heartbeat using ollama.localModelRefreshInterval setting
- [x] Register `opilot.checkServerHealth` command
- [x] Add unit tests for health check helper

## Summary of Changes

New `src/statusBar.ts` module encapsulates the status bar feature entirely. `registerStatusBarHeartbeat()` creates the status bar item, fires an immediate health check, then polls on the `ollama.localModelRefreshInterval` interval (default 30s). Failures are debounced — 2 consecutive failures required before showing the offline warning state so transient network hiccups don't cause flicker. The config listener reschedules the interval if the user changes the refresh interval setting. All three resources (item, interval, config listener) are disposed cleanly. 11 unit tests cover all states including debounce, recovery, disposal, and live config changes.
