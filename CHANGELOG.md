# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `LanguageModelChatProvider` registration under vendor `selfagency-ollama`, making local Ollama models available in GitHub Copilot Chat and the VS Code model picker
- `@ollama` chat participant (`ollama-copilot.ollama`) with history-aware direct streaming to the Ollama API
- Tool calling support for compatible models (e.g. `qwen2.5`, `llama3.1`) via the VS Code LM tool API; all models advertise `toolCalling: true` for picker visibility
- Full agentic tool-invocation loop in `@ollama` participant (up to 10 rounds)
- Vision / multimodal image input support
- Thinking model support — automatically retries with `think: false` when the model does not support extended thinking; streaming responses from thinking models display a collapsible "Thinking" section followed by a "Response" section
- Model management sidebar with four panels: **Local Models**, **Cloud Models**, **Library**, and **Modelfiles**
- Model capability badges shown in the sidebar: 🧠 thinking, 🛠️ tool calling, 👁️ vision, 🧩 embedding; family group nodes aggregate badges from all child variants
- Model family grouping for Local Models, Cloud Models, and Library panels — models are grouped into collapsible family nodes by default with a toggle to switch to a flat list
- Filter bar for Local Models, Cloud Models, and Library panels (`ollama-copilot.filterLocalModels`, `ollama-copilot.filterCloudModels`, `ollama-copilot.filterLibraryModels`) with corresponding clear commands
- Collapse-all toolbar button for each sidebar panel (`ollama-copilot.collapseLocalModels`, `ollama-copilot.collapseCloudModels`, `ollama-copilot.collapseLibrary`)
- Cloud Models panel that lists models from Ollama Cloud (requires `ollama login`); includes start, stop, delete, and open-page actions
- `ollama-copilot.loginCloud` command shown as a toolbar button in the Cloud Models panel header
- Streaming pull progress shown in the sidebar when downloading models from the library (`ollama-copilot.pullModelFromLibrary`)
- **Modelfile Manager** sidebar pane with syntax highlighting, hover documentation, and autocomplete for Modelfile instructions (including the `REQUIRES` keyword and all common `PARAMETER` names)
- `ollama-copilot.openModelfilesFolder` command to reveal the modelfiles directory in the OS file manager
- Inline code completion provider (fill-in-middle) for all locally running Ollama models
- Library model panel with collapsible variant children; supports newest-first sorting (`?sort=newest`); downloaded variants show a ✓ checkmark
- Key-icon auth token management button in panel headers (`ollama-copilot.manageAuthToken`)
- Remote Ollama instance support with configurable host URL and Bearer token stored in VS Code secrets
- Log streaming from the Ollama server process (macOS, Linux, Windows)
- `ollama-copilot.dumpPerformanceSnapshot` command — writes a structured JSON snapshot of Node.js memory usage and sidebar cache state to the Ollama output channel
- Conflict detection: optionally removes the VS Code built-in Ollama provider entry if this extension is active
- Per-request Ollama client instantiation so host/token changes take effect immediately
- Model list caching with a 5-second throttle and 6-hour background refresh for model info
- Auto-refresh timer for local and running models: defaults to every 30 seconds, configurable via `ollama.localModelRefreshInterval`; interval restarts automatically on settings change
- `ollama.libraryRefreshInterval` setting defined (default 21600 s) for future periodic refresh of library and cloud catalogs; Library and Cloud panels currently refresh on startup and on-demand via the manual refresh button
- `ollama.diagnostics.logLevel` setting to control extension output channel verbosity (`debug`, `info`, `warn`, `error`)
- `ollama.contextLength` setting to override the model's context window size (default `0` = use model default)
- `Ollama` category applied to all contributed commands

### Fixed

- `participant.iconPath` now uses `vscode.Uri.joinPath` so the icon resolves correctly in remote and web extension hosts
- Tool result messages in the direct Ollama agentic loop now include `tool_call_id` so Ollama can correlate results with the originating call
- VS Code LM API fallback agentic loop now buffers assistant text alongside tool-call parts and appends the full assistant turn to the conversation, ensuring subsequent rounds have complete context
- Non-tool-calling models now appear in the VS Code model picker (resolved by advertising `toolCalling: true` unconditionally; native support tracked separately)
- LM response streamed per-token rather than buffered to a single chunk
- Cloud model run flow: pull model before start; model name suffixes applied correctly
