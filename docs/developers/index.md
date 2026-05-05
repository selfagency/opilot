---
title: Developer Guide
---

This guide covers everything you need to build, test, and contribute to **Opilot**.

## Prerequisites

| Tool                | Version                  |
| ------------------- | ------------------------ |
| Node.js             | 20+                      |
| pnpm                | pinned in `package.json` |
| VS Code             | 1.111.0+                 |
| Ollama              | latest                   |
| GitHub Copilot Chat | latest                   |

Install `task` (the Taskfile runner):

```bash
brew install go-task
# or
npm install -g @go-task/cli
```

## Setting Up

```bash
# Clone
git clone https://github.com/selfagency/opilot
cd opilot

# Install dependencies
pnpm install

# Build
task compile
```

## Running the Extension

Press **F5** in VS Code to open an **Extension Development Host** with the extension loaded. Changes require re-running `task compile` (or use `task watch` for incremental rebuilds).

## Available Tasks

Run tasks with `task <name>`:

| Task                 | Description                                  |
| -------------------- | -------------------------------------------- |
| `compile`            | Type-check + bundle the extension            |
| `watch`              | Watch mode — rebuild on file change          |
| `lint`               | Run oxlint                                   |
| `lint-fix`           | Auto-fix lint issues                         |
| `check-formatting`   | Check code formatting (oxfmt)                |
| `check-types`        | TypeScript type check only                   |
| `unit-tests`         | Run Vitest unit tests                        |
| `unit-test-coverage` | Unit tests + coverage report                 |
| `extension-tests`    | VS Code integration tests                    |
| `integration-tests`  | End-to-end tests (requires Ollama)           |
| `precommit`          | Full pre-commit check (type + lint + format) |
| `release`            | Build and publish a release                  |

## Directory Structure

```
src/
  extension.ts         # Activation, chat participant, log streaming
  provider.ts          # VS Code LM API provider implementation
  sidebar.ts           # Tree views, model lifecycle commands
  modelfiles.ts        # Modelfile parsing and tree provider
  completions.ts       # Inline code completion provider
  formatting.ts        # Re-exports context/format/xml-filter utilities from focused @agentsy packages
  thinkingParser.ts    # Re-exports ThinkingParser from @agentsy/thinking
  toolUtils.ts         # Re-exports XML tool utilities from @agentsy/tool-calls + Ollama-specific helpers
  diagnostics.ts       # Centralized logging abstraction
  client.ts            # Ollama HTTP client wrapper
  test/
    vscode.mock.ts     # VS Code API mock (used by Vitest)
docs/
  ARCHITECTURE.md      # Architecture overview
  plans/               # Planning notes and design docs
syntaxes/
  modelfile.tmLanguage.json  # Modelfile syntax grammar
.vitepress/            # Docs site config
```

## Next Steps

- [Architecture](./architecture) — understand the key flows
- [Contributing](./contributing) — branch, commit, and PR conventions
- [Testing](./testing) — unit tests, extension tests, integration tests
