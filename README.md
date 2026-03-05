# Ollama for Copilot

[![Tests](https://github.com/selfagency/ollama-copilot/actions/workflows/ci.yml/badge.svg)](https://github.com/selfagency/ollama-copilot/actions/workflows/ci.yml) [![codecov](https://codecov.io/gh/selfagency/ollama-copilot/graph/badge.svg?token=W9kOrFPSQ1)](https://codecov.io/gh/selfagency/ollama-copilot)

<p align="center">
  <img src="logo.png" alt="Ollama Logo" width="128" height="128">
</p>

<p align="center">
  <strong>Run Ollama models locally within GitHub Copilot Chat</strong>
</p>

<p align="center">
  <a href="https://ollama.ai">🌐 Ollama</a> •
  <a href="https://github.com/ollama/ollama">📖 GitHub Repo</a> •
  <a href="https://ollama.ai/library">📚 Model Library</a>
</p>

## ✨ Features

- 🧠 **All Ollama Models** - Browse and run any model from the [Ollama Library](https://ollama.ai/library) or use locally installed models
- 🏠 **Local Execution** - Models run on your machine with full privacy—no data leaves your computer
- 🔀 **Model Selection** - Choose between local models, cloud library models, or running Ollama instances
- 💬 **Chat Participant** - Invoke `@ollama` directly in Copilot Chat for a dedicated, history-aware conversation with your local model
- 🔧 **Tool Calling** - Function calling support for agentic workflows with compatible models
- 🖼️ **Vision Support** - Image input for models with vision capabilities
- 🛠️ **Model Management** - Pull, manage, and delete models directly from VS Code sidebar
- 📝 **Modelfile Support** - Syntax highlighting and editing for custom Ollama modelfiles
- ⚡ **Streaming** - Real-time response streaming for faster interactions
- 🔒 **Secure Communication** - All interactions with local Ollama instance (no external API required)

## 🔧 Requirements

- **VS Code** 1.109.0 or higher
- **GitHub Copilot Chat** extension installed
- **Ollama** installed and running locally ([Download](https://ollama.ai/download)) OR access to a remote Ollama instance

## 🚀 Installation

1. **Install Ollama** - Download and install from [ollama.ai](https://ollama.ai/download)
2. **Start Ollama** - Run `ollama serve` (or use the system app)
3. **Install Extension** - Install from VS Code Marketplace (or install the `.vsix` file)
4. **Pull a Model** - Use the sidebar to pull a model, or run `ollama pull llama2` from terminal

The extension will auto-detect your local Ollama instance at `http://localhost:11434` by default.

## ⚙️ Configuration

Open VS Code Settings (`Ctrl+,` / `Cmd+,`) and search for "Ollama":

- **`ollama.host`** - Ollama server address (default: `http://localhost:11434`)
- **`ollama.contextLength`** - Context window size for models (default: `1024`)
- **`ollama.streamLogs`** - Stream Ollama server logs to output channel (default: `true`)

To use a remote Ollama instance, update `ollama.host` to point to your remote server.

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

### Sidebar: Model Management

The Ollama sidebar provides three sections:

#### Local Models

- View installed models on your system
- Right-click to run, stop, or delete models
- See memory usage of running models

#### Library Models

- Browse 100+ pre-configured models from [ollama.ai/library](https://ollama.ai/library)
- Sort by recency or name
- Click to view details, preview capabilities, or pull to local system

#### Running Models

- Monitor active models in real-time
- View context window and memory usage
- Stop models when done

### Modelfile Support

The extension provides syntax highlighting for `.modelfile` files. Create custom models by defining them in a Modelfile:

```modelfile
FROM llama2
PARAMETER temperature 0.7
SYSTEM You are a helpful coding assistant.
```

See the [Ollama Modelfile Docs](https://github.com/ollama/ollama/blob/main/docs/modelfile.md) for full syntax.

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
- [VS Code](https://code.visualstudio.com/) 1.109.0+

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

- [Ollama GitHub](https://github.com/ollama/ollama) - Main Ollama repository
- [Ollama Model Library](https://ollama.ai/library) - Browse available models
- [Ollama API Docs](https://github.com/ollama/ollama/blob/main/docs/api.md) - REST API documentation
- [Ollama Modelfile Docs](https://github.com/ollama/ollama/blob/main/docs/modelfile.md) - Create custom models
- [VS Code Language Model API](https://code.visualstudio.com/api/references/vscode-api#LanguageModelsAPI) - Extension API reference
