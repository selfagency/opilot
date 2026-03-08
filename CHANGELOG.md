# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0-rc.1] - 2026-03-08

## What's Changed

- Phase 2: Settings UI & Authentication Management (cndp) by @selfagency in https://github.com/selfagency/opilot/pull/1
- feat(sidebar): improve logging, reorder panels, add library and running model enhancements by @selfagency in https://github.com/selfagency/opilot/pull/3
- feat(commands): add Ollama category to all contributed commands by @selfagency in https://github.com/selfagency/opilot/pull/6
- feat(sidebar): streaming pull progress and model capability badges by @selfagency in https://github.com/selfagency/opilot/pull/5
- feat: Modelfile Manager sidebar pane (ollama-models-vscode-b14z) by @selfagency in https://github.com/selfagency/opilot/pull/8
- fix: stream LM response chunks per-token (s90p) by @selfagency in https://github.com/selfagency/opilot/pull/9
- fix(0i0b): replace text labels with key icon buttons in panel headers by @selfagency in https://github.com/selfagency/opilot/pull/10
- fix(22ff): remove model details view and associated commands by @selfagency in https://github.com/selfagency/opilot/pull/12
- fix(j7cp): fetch ?sort=newest from ollama.com when recency sort is active by @selfagency in https://github.com/selfagency/opilot/pull/11
- feat(4vps): inline code completion provider by @selfagency in https://github.com/selfagency/opilot/pull/14
- feat(5cul): library model collapsible variants with download children by @selfagency in https://github.com/selfagency/opilot/pull/15
- Fix non-tool model visibility in VS Code chat pickers by @selfagency in https://github.com/selfagency/opilot/pull/17
- Fix cloud model run flow: pull before start and improve cloud/library UX by @selfagency in https://github.com/selfagency/opilot/pull/18
- Fix cloud model run flow: use proper model suffixes by @selfagency in https://github.com/selfagency/opilot/pull/21
- fix: correctness, security & completeness review by @selfagency in https://github.com/selfagency/opilot/pull/24
- test: increase unit test coverage (ollama-models-vscode-7not) by @selfagency in https://github.com/selfagency/opilot/pull/26
- fix(provider,sidebar): inject cloud API key for cloud-tagged model requests [6ogy] by @selfagency in https://github.com/selfagency/opilot/pull/27
- docs: Update funding sources in FUNDING.yml by @selfagency in https://github.com/selfagency/opilot/pull/39
- docs: Fix funding model format for GitHub entry by @selfagency in https://github.com/selfagency/opilot/pull/40
- feat: strip images for non-vision models, sidebar UX polish, and provider hardening by @selfagency in https://github.com/selfagency/opilot/pull/41
- feat: code review improvements — security, testing, performance, docs by @selfagency in https://github.com/selfagency/opilot/pull/43

**Full Changelog**: https://github.com/selfagency/opilot/commits/v0.1.0-rc.1

### Added

- `LanguageModelChatProvider` registration under vendor `selfagency-opilot`, making local Ollama models available in GitHub Copilot Chat and the VS Code model picker
- `@ollama` chat participant (`opilot.ollama`) with history-aware direct streaming to the Ollama API
- Tool calling support for compatible models (e.g. `qwen2.5`, `llama3.1`) via the VS Code LM tool API; all models advertise `toolCalling: true` for picker visibility
- Full agentic tool-invocation loop in `@ollama` participant (up to 10 rounds)
- Vision / multimodal image input support
- Thinking model support — automatically retries with `think: false` when the model does not support extended thinking; streaming responses from thinking models display a collapsible "Thinking" section followed by a "Response" section
- Model management sidebar with four panels: **Local Models**, **Cloud Models**, **Library**, and **Modelfiles**
- Model capability badges shown in the sidebar: 🧠 thinking, 🛠️ tool calling, 👁️ vision, 🧩 embedding; family group nodes aggregate badges from all child variants
- Model family grouping for Local Models, Cloud Models, and Library panels — models are grouped into collapsible family nodes by default with a toggle to switch to a flat list
- Filter bar for Local Models, Cloud Models, and Library panels (`opilot.filterLocalModels`, `opilot.filterCloudModels`, `opilot.filterLibraryModels`) with corresponding clear commands
- Collapse-all toolbar button for each sidebar panel (`opilot.collapseLocalModels`, `opilot.collapseCloudModels`, `opilot.collapseLibrary`)
- Cloud Models panel that lists models from Ollama Cloud (requires `ollama login`); includes start, stop, delete, and open-page actions
- `opilot.loginCloud` command shown as a toolbar button in the Cloud Models panel header
- Streaming pull progress shown in the sidebar when downloading models from the library (`opilot.pullModelFromLibrary`)
- **Modelfile Manager** sidebar pane with syntax highlighting, hover documentation, and autocomplete for Modelfile instructions (including the `REQUIRES` keyword and all common `PARAMETER` names)
- `opilot.openModelfilesFolder` command to reveal the modelfiles directory in the OS file manager
- Inline code completion provider (fill-in-middle) for all locally running Ollama models
- Library model panel with collapsible variant children; supports newest-first sorting (`?sort=newest`); downloaded variants show a ✓ checkmark
- Key-icon auth token management button in panel headers (`opilot.manageAuthToken`)
- Remote Ollama instance support with configurable host URL and Bearer token stored in VS Code secrets
- Log streaming from the Ollama server process (macOS, Linux, Windows)
- `opilot.dumpPerformanceSnapshot` command — writes a structured JSON snapshot of Node.js memory usage and sidebar cache state to the Ollama output channel
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
