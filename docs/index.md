---
title: Opilot — Ollama for GitHub Copilot VS Code Extension
---

<p align="center">
  <img src="/logo.png" alt="Opilot" width="128" height="128" />
</p>

<p align="center">
  <strong>Run Ollama models with full tool and vision support inside GitHub Copilot Chat</strong>
</p>

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

<div style="display:flex;flex-direction:row;align-items:center;justify-content:center;gap:0.5rem;flex-wrap:wrap;margin-bottom:1.5rem;">

<div style="display:flex;flex-direction:row;align-items:center;gap:0.25rem;">

<div>

[![Version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fselfagency%2Fopilot%2Fmain%2Fpackage.json&query=%24.version&label=Version&color=blue)](https://github.com/selfagency/opilot/releases)

</div>

<div>

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

</div>

</div>

</div>

**Opilot** integrates the full Ollama ecosystem — local models, cloud models, and the Ollama model library — directly into VS Code's Copilot Chat interface. Your conversations never leave your machine when using local models, and you can switch between models without leaving the editor.

## Key Features

- **🦙 All Ollama Models** — Use any model from the [Ollama Library](https://ollama.ai/library), including Cloud models (after `ollama login`), as first-class Copilot chat models and as the `@ollama` participant
- **🛠️ Model Management Sidebar** — Pull, run, inspect, stop, and delete models from a dedicated Ollama activity bar panel with live status badges
- **💬 Chat Participant** — Invoke `@ollama` in Copilot Chat for a dedicated, history-aware conversation with your chosen local model
- **📝 Modelfile Manager** — Create, edit, and build custom Ollama modelfiles with syntax highlighting, hover documentation, and autocomplete
- **⌨️ Inline Code Completions** — Get fill-in-the-middle code suggestions powered by a local Ollama model as you type
- **🔧 Tool Calling** — Full tool/function-calling support for agentic workflows with compatible models (MCP servers, VS Code commands, custom skills)
- **🖼️ Vision Support** — Image input for models with vision capabilities; non-vision models automatically have images stripped to avoid prompt overflow
- **💭 Thinking Models** — Extended reasoning with collapsible "Thinking" and "Response" sections for models that expose chain-of-thought (e.g., DeepSeek-R1, Qwen QwQ, Kimi)
- **🏠 Local Execution & Privacy** — Local models run entirely on your machine; no data is sent to any external service
- **⚡ Streaming** — Real-time token streaming for low-latency responses in both the chat participant and provider paths
- **🔒 Secure Token Storage** — Authentication tokens for remote Ollama instances are stored in VS Code's encrypted secrets API

## Requirements

- **VS Code** 1.111.0 or higher
- **GitHub Copilot Chat** extension installed and active
- **Ollama** installed locally ([Download](https://ollama.ai/download)) **or** a remote Ollama instance you control
- For cloud models: run `ollama login` to authenticate

## Quick Start

1. [Install Ollama](https://ollama.ai/download) and start it (`ollama serve` or open the app)
2. Install **Opilot** from the VS Code Marketplace (or install the `.vsix` file)
3. The Ollama icon appears in the activity bar — click it to open the sidebar
4. Pull a model from the **Library** panel (e.g., `llama3.2:3b`)
5. Open Copilot Chat, click the model picker, and select your Ollama model — or type `@ollama` to chat

→ [Full Getting Started guide](./getting-started)

## About Ollama

[Ollama](https://github.com/ollama/ollama) is an open-source tool for running large language models locally. It provides a simple API, a growing library of pre-quantized models, and support for custom modelfiles to define personas and fine-tuned configurations.

**Why local models?**

- ✅ Complete privacy — no conversations leave your machine
- ✅ No per-token billing
- ✅ Works offline
- ✅ Fine-grained control over model parameters
- ✅ Experiment with cutting-edge open-source models
