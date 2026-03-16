# Opilot — Ollama for GitHub Copilot VS Code Extension

[![Version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fselfagency%2Fopilot%2Fmain%2Fpackage.json&query=%24.version&label=Version&color=blue)](https://github.com/selfagency/opilot/releases) [![Tests](https://github.com/selfagency/opilot/actions/workflows/ci.yml/badge.svg)](https://github.com/selfagency/opilot/actions/workflows/ci.yml) [![codecov](https://codecov.io/gh/selfagency/opilot/graph/badge.svg?token=W9kOrFPSQ1)](https://codecov.io/gh/selfagency/opilot) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

<p align="center">
  <img src="logo.png" alt="Opilot" width="128" height="128">
</p>

<p align="center">
  <strong>Run Ollama models with full tool and vision support inside GitHub Copilot Chat</strong>
</p>

**Opilot** integrates the full Ollama ecosystem — local models, cloud models, and the Ollama model library — directly into VS Code's Copilot Chat interface. Your conversations never leave your machine when using local models, and you can switch between models without leaving the editor.

<p align="center">
  <a href="https://opilot.self.agency">📖 Docs</a> •
  <a href="https://marketplace.visualstudio.com/items?itemName=selfagency.opilot">🛒 Marketplace</a> •
  <a href="https://github.com/selfagency/opilot">🐙 GitHub</a> •
  <a href="https://github.com/selfagency/opilot/issues">🐛 Issues</a>
</p>

<p align="center">
  <a href="https://ollama.ai">🌐 Ollama</a> •
  <a href="https://github.com/ollama/ollama">📖 Ollama Repo</a> •
  <a href="https://ollama.ai/library">📚 Model Library</a>
</p>

## ✨ Features

- 🦙 **All Ollama Models** — Use any model from the [Ollama Library](https://ollama.ai/library), including Cloud models (after `ollama login`), as first-class Copilot chat models and as the `@ollama` participant
- 🛠️ **Model Management Sidebar** — Pull, run, inspect, stop, and delete models from a dedicated Ollama activity bar panel with live status badges
- 🎛️ **Per-Model Settings Panel** — Tune temperature, top-p/top-k, context, max tokens, and thinking budget from an in-editor webview; settings persist per model
- 📡 **Status Bar Heartbeat** — Always-visible Ollama server indicator with running model count, connectivity state, and resource tooltip
- 💬 **Chat Participant** — Invoke `@ollama` in Copilot Chat for a dedicated, history-aware conversation with your chosen local model
- 📝 **Modelfile Manager** — Create, edit, and build custom Ollama modelfiles with syntax highlighting, hover documentation, and autocomplete
- ⌨️ **Inline Code Completions** — Get fill-in-the-middle code suggestions powered by a local Ollama model as you type
- 🔧 **Tool Calling** — Full tool/function-calling support for agentic workflows with compatible models (MCP servers, VS Code commands, custom skills)
- 🖼️ **Vision Support** — Image input for models with vision capabilities; non-vision models automatically have images stripped to avoid prompt overflow
- 💭 **Thinking Models** — Extended reasoning with collapsible "Thinking" and "Response" sections for models that expose chain-of-thought (e.g., DeepSeek-R1, Qwen QwQ, Kimi)
- 🏠 **Local Execution & Privacy** — Local models run entirely on your machine; no data is sent to any external service
- ⚡ **Streaming** — Real-time token streaming for low-latency responses in both the chat participant and provider paths
- 🔒 **Secure Token Storage** — Authentication tokens for remote Ollama instances are stored in VS Code's encrypted secrets API

## 🔧 Requirements

- **VS Code** 1.111.0 or higher
- **GitHub Copilot Chat** extension installed and active
- **Ollama** installed locally ([Download](https://ollama.ai/download)) **or** a remote Ollama instance you control

## 🚀 Quick Start

1. [Install Ollama](https://ollama.ai/download) and start it (`ollama serve` or open the app)
2. Install **Opilot** from the VS Code Marketplace (or install the `.vsix` file)
3. The Ollama icon appears in the activity bar — click it to open the sidebar
4. Pull a model from the **Library** panel (e.g., `llama3.2:3b`)
5. Open Copilot Chat, click the model picker, and select your Ollama model — or type `@ollama` to chat

The extension auto-detects your local Ollama instance at `http://localhost:11434`. To use cloud models, run `ollama login` first. To use a remote instance, set `opilot.host` in VS Code settings (legacy `ollama.host` is still supported).

## ⚙️ Configuration

Open VS Code Settings (`Ctrl+,` / `Cmd+,`) and search for "Opilot":

- **`opilot.host`** - Ollama server address (default: `http://localhost:11434`)
- **`opilot.streamLogs`** - Stream Ollama server logs to output channel (default: `true`)
- **`opilot.localModelRefreshInterval`** - Auto-refresh interval for local and running models, in seconds (default: `30`)
- **`opilot.libraryRefreshInterval`** - Reserved refresh interval for library and cloud model catalogs, in seconds (default: `21600`); panels currently refresh on startup and via the manual refresh button
- **`opilot.completionModel`** - Model used for inline code completions (e.g. `qwen2.5-coder:1.5b`). Leave empty to disable.
- **`opilot.enableInlineCompletions`** - Enable or disable inline code completions (default: `true`)
- **`opilot.modelfilesPath`** - Folder where modelfiles are stored (default: `~/.ollama/modelfiles`)
- **`opilot.diagnostics.logLevel`** - Verbosity of the Ollama output channel (`debug`, `info`, `warn`, `error`; default: `info`)

Legacy `ollama.*` settings continue to work and are migrated automatically on activation.

To use a remote Ollama instance, update `opilot.host` to point to your remote server.

## 💬 Usage

### Model Picker

To use an Ollama model in Copilot Chat without the `@ollama` handle:

1. Open **GitHub Copilot Chat** panel in VS Code
2. Click the **model selector** dropdown
3. Choose an **Ollama** model (local or from library)
4. Start chatting!

### Chat Participant

Type `@ollama` in any Copilot Chat input to direct the conversation to your local Ollama instance:

```text
@ollama explain the architecture of this TypeScript project
```

The participant is sticky — once invoked, it stays active for the thread.

### Inline Code Completions

Set `opilot.completionModel` to a locally-installed model to get inline code completions as you type. Smaller, fast models work best:

- `qwen2.5-coder:1.5b`
- `deepseek-coder:1.3b`
- `starcoder2:3b`

Completions use fill-in-the-middle (FIM) when the model supports it, and can be toggled with `opilot.enableInlineCompletions`.

### Sidebar: Model Management

The Ollama activity bar icon opens a sidebar with four panels:

#### Local Models

- View all locally installed models grouped by family (tree view) or as a flat list
- Filter models by name using the filter icon in the panel header
- Toggle between grouped tree view and flat list with the layout icon
- Open **Model Settings** from the gear icon in the Local Models toolbar
- Inline buttons per model: **Start** (▶), **Stop** (⏹), **Delete** (🗑)
- Running models show VRAM usage and how long they've been loaded
- Model capability badges: 🧠 thinking, 🛠️ tools, 👁️ vision, 🧩 embedding
- Auto-refreshes every 30 seconds (configurable via `opilot.localModelRefreshInterval`); refresh interval restarts automatically when the setting changes

### Model Settings Panel

Open **Ollama: Open Model Settings** (or click the gear icon in Local Models) to configure per-model generation overrides:

- Temperature
- Top-P
- Top-K
- Context window (`num_ctx`)
- Max tokens (`num_predict`)
- Thinking toggle (`think`)
- Thinking budget (`think_budget`)

Changes apply immediately and are persisted per model in the extension global storage.

### Status Bar Heartbeat

Opilot adds a persistent status bar item:

- `$(loading~spin) Ollama…` while checking
- `$(pulse) Ollama` or `$(pulse) Ollama (N)` when reachable
- `$(warning) Ollama offline` after debounced failures

Click the status bar item (or run **Ollama: Check Server Health**) for an immediate connectivity check.

#### Cloud Models

- View models pulled from Ollama Cloud (requires `ollama login`)
- Filter, group by family, and collapse all — same controls as Local Models
- Inline buttons: **Open page** (🔗), **Run** (▶), **Stop** (⏹), **Delete** (🗑)
- Use the **Login** (👤) button in the panel header to authenticate

#### Library

- Browse hundreds of pre-configured models from [ollama.ai/library](https://ollama.ai/library)
- Models grouped by family with collapsible variant children
- Filter by name; sort by newest or name
- Variants already downloaded locally show a ✓ checkmark
- Click **Pull** (⬇) on any variant to download it with streaming progress

#### Modelfiles

The **Modelfile Manager** pane for creating and managing custom Ollama modelfiles. See [Modelfile Manager](#modelfile-manager) below.

### Modelfile Manager

#### Creating a new Modelfile

Click the **+** button in the Modelfile Manager pane header. An interactive wizard will guide you through:

1. **Name** — enter a name for the modelfile (e.g. `pirate-bot`)
2. **Base model** — pick a model from your locally installed Ollama models
3. **System prompt** — describe the AI persona or task

The wizard creates the file, pre-populates it with the chosen settings, and opens it in the editor.

#### Building a Modelfile

Right-click any `.modelfile` in the pane and choose **Build Model from Modelfile** (or use the command palette: `Ollama: Build Model from Modelfile`). This runs `ollama create` with the file and streams progress in a VS Code notification.

#### Syntax support

All `.modelfile` files receive:

- **Syntax highlighting** — keywords (`FROM`, `PARAMETER`, `SYSTEM`, `TEMPLATE`, `ADAPTER`, `LICENSE`, `MESSAGE`, `REQUIRES`), parameter names, numbers, strings, and comments
- **Hover documentation** — hover over any keyword or parameter name to see its description and usage
- **Autocomplete** — suggestions for Modelfile keywords and common parameter names

```modelfile
# Modelfile — pirate-bot
FROM llama3.2:3b

SYSTEM """You are a helpful pirate assistant. Arr!"""

PARAMETER temperature 0.7
PARAMETER num_ctx 4096
```

See the [Ollama Modelfile Docs](https://github.com/ollama/ollama/blob/main/docs/modelfile.md) for the full syntax reference.

## 🛡️ Privacy & Security

- Your models and conversations run **completely locally** - no data is sent to external services
- The extension communicates only with your local Ollama instance (or your specified remote instance)
- No telemetry, tracking, or data collection
- Authentication tokens (if using a remote instance) are stored securely using VS Code's encrypted secrets API

For more information on Ollama's security and privacy model, see the [Ollama GitHub repository](https://github.com/ollama/ollama).

## 🛠️ Development

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) (version pinned in `package.json`)
- [VS Code](https://code.visualstudio.com/) 1.111.0+

### Build

```bash
pnpm install
pnpm run compile        # type-check + lint + bundle
pnpm run watch          # parallel watch for type-check and bundle
```

### Testing

```bash
pnpm test               # unit tests (Vitest)
pnpm run test:coverage  # unit tests with coverage (target: 85%)
pnpm run test:extension # VS Code integration tests
pnpm run lint           # static analysis (oxlint)
```

### Debugging

Open the project in VS Code and press **F5** to launch the Extension Development Host with the extension loaded.

## 📄 License

MIT License - See [LICENSE](LICENSE) for details.

Maintained by [Daniel Sieradski](https://self.agency) ([@selfagency](https://github.com/selfagency)).

## 📚 Resources

### Opilot

- [Documentation](https://opilot.self.agency) - Full user and developer docs
- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=selfagency.opilot) - Install from the marketplace
- [GitHub Repository](https://github.com/selfagency/opilot) - Source code and releases
- [GitHub Issues](https://github.com/selfagency/opilot/issues) - Bug reports and feature requests

### Ollama

- [Ollama GitHub](https://github.com/ollama/ollama) - Main Ollama repository
- [Ollama Model Library](https://ollama.ai/library) - Browse available models
- [Ollama API Docs](https://github.com/ollama/ollama/blob/main/docs/api.md) - REST API documentation
- [Ollama Modelfile Docs](https://github.com/ollama/ollama/blob/main/docs/modelfile.md) - Create custom models
- [VS Code Language Model API](https://code.visualstudio.com/api/references/vscode-api#LanguageModelsAPI) - Extension API reference
