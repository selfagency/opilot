---
title: Sidebar & Model Management
---

The Ollama sidebar is your command center for model lifecycle management. Click the 🦙 icon in the activity bar to open it.

## Local Models Panel

Shows all models that have been pulled to your machine.

### Model Tree

Models are grouped by **family** (tree view) by default. Each family node collapses/expands to show its variants (e.g., `llama3.2` → `3b`, `1b`).

Toggle to a flat list with the **Show as Flat List** button (⊞) in the panel header, or back to grouped with **Show as Tree** (⊞).

### Capability Badges

Each model item shows capability indicators:

- 🧠 Thinking / chain-of-thought
- 🛠 Tool calling
- 👁 Vision (image input)
- 🧩 Embedding model

### Status Indicators

- **Running** — the model is currently loaded in Ollama's memory. Shows VRAM used and how long it has been loaded.
- **Stopped** — the model is installed but not loaded.

### Inline Buttons

Right side of each running or stopped model item:

| Button    | When    | Action                   |
| --------- | ------- | ------------------------ |
| ▶ Start   | Stopped | Load model into memory   |
| ⏹ Stop    | Running | Unload model from memory |
| 🗑 Delete | Stopped | Remove model from disk   |

Running models cannot be deleted — stop them first.

### Panel Toolbar

| Button           | Action                                 |
| ---------------- | -------------------------------------- |
| 🔑               | Manage auth token for remote instances |
| ⚙ Model settings | Open per-model parameter controls      |
| 🔍 Filter        | Type to filter by model name           |
| ✕ Clear filter   | Remove active filter                   |
| ⊞ / ⊟            | Toggle grouped tree / flat list        |
| 🔄 Refresh       | Reload local model list                |
| ⊖ Collapse all   | Collapse all family groups             |

The list auto-refreshes every 30 seconds (configurable via `ollama.localModelRefreshInterval`).

### Model Settings Webview

Use the **⚙ Model settings** button (or `Ollama: Open Model Settings`) to open a webview with per-model controls for:

- `temperature`, `top_p`, `top_k`
- `num_ctx`, `num_predict`
- `think`, `think_budget`

Updates are applied immediately and persisted per model.

---

## Status Bar Heartbeat

Outside the sidebar, Opilot shows a persistent status bar heartbeat:

- **Loading:** `$(loading~spin) Ollama…`
- **Online:** `$(pulse) Ollama` or `$(pulse) Ollama (N)`
- **Offline:** `$(warning) Ollama offline` (after 2 consecutive failures)

The tooltip includes host, per-model memory, and processor (CPU/GPU) details for currently running models.

---

## Cloud Models Panel

Shows models from **Ollama Cloud** — premium hosted models that run server-side but appear in the sidebar like local models.

### Authentication

Click the **Login** (👤) button in the panel header to authenticate. This triggers `ollama login` via the Ollama CLI. Once authenticated, cloud models are fetched automatically.

### Inline Buttons

| Button    | When    | Action                             |
| --------- | ------- | ---------------------------------- |
| 🔗        | Always  | Open the model's page on ollama.ai |
| ▶ Run     | Stopped | Activate the cloud model           |
| ⏹ Stop    | Running | Deactivate the cloud model         |
| 🗑 Delete | Stopped | Remove from your account           |

Cloud model names end with `:cloud` to distinguish them from local variants.

---

## Library Panel

Browses the full [Ollama model library](https://ollama.ai/library). Models are displayed as family nodes with expandable variant children.

### Pulling a Model

1. Expand a family to see its variants (e.g., `3b`, `7b`, `13b`, `70b`)
2. Click **Pull** (⬇) on the variant you want
3. A streaming progress notification shows download progress

Variants already installed locally show a **✓** checkmark.

### Filtering & Grouping

| Button     | Action                       |
| ---------- | ---------------------------- |
| 🔍 Filter  | Type to filter by model name |
| ✕ Clear    | Remove active filter         |
| ⊞ / ⊟      | Toggle grouped / flat view   |
| 🔄 Refresh | Re-fetch from ollama.ai      |
| ⊖ Collapse | Collapse all families        |
| 🔗         | Open model page on ollama.ai |

The library is fetched on startup. Use the refresh button or wait for the scheduled refresh (configurable via `ollama.libraryRefreshInterval`, default 6 hours).

---

## Modelfiles Panel

See the dedicated [Modelfile Manager](./modelfiles) page.
