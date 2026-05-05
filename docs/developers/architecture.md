---
title: Architecture
---

This page gives a detailed overview of the extension architecture and key runtime flows.

## Module Map

| Module                  | Purpose                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/extension.ts`      | Activation entrypoint: registers provider, chat participant, sidebar, log streaming                                                         |
| `src/provider.ts`       | VS Code Language Model API provider — handles generate/chat, tools, capability tracking                                                     |
| `src/sidebar.ts`        | Sidebar tree views, model lifecycle commands (pull/run/stop/delete)                                                                         |
| `src/modelfiles.ts`     | Modelfile parsing, Modelfiles tree provider, `ollama create` integration                                                                    |
| `src/completions.ts`    | VS Code inline completion provider using a local Ollama model                                                                               |
| `src/formatting.ts`     | Re-exports context/formatting/XML filter utilities from focused `@agentsy/*` packages                                                       |
| `src/thinkingParser.ts` | Re-exports `ThinkingParser` from [`@agentsy/thinking`](https://www.npmjs.com/package/@agentsy/thinking)                                     |
| `src/toolUtils.ts`      | Re-exports XML tool call utilities from [`@agentsy/tool-calls`](https://www.npmjs.com/package/@agentsy/tool-calls); Ollama-specific helpers |
| `src/diagnostics.ts`    | Centralized structured logging to the VS Code output channel                                                                                |
| `src/client.ts`         | Thin Ollama HTTP client wrapper (auth header injection, error normalization)                                                                |

## Activation Flow

When VS Code activates the extension, `activate()` in `extension.ts`:

1. Creates a `DiagnosticsLogger` (output channel: "Opilot")
2. Reads configuration (`ollama.host`, etc.) and creates an `OllamaClient`
3. Registers the **VS Code Language Model provider** (`selfagency-opilot` vendor)
4. Registers the **`@ollama` chat participant**
5. Registers the **inline completion provider** (if `ollama.completionModel` is set)
6. Initializes the **sidebar** (four tree views + their commands)
7. Initializes the **Modelfile Manager**
8. Starts **Ollama server log streaming** (if `ollama.streamLogs` is true)

## Chat Request Paths

There are two distinct paths for handling chat/LM requests:

### Direct path (`extension.ts`)

Used when the user types in the `@ollama` chat participant:

```text
User → @ollama → handleChatRequest(extension.ts)
  → convertVSCodeHistoryToOllamaMessages()
  → extractLeadingXmlContextBlocks()   ← deduplicated, prepended as system msg
  → [optional] VS Code tool invocation loop
  → ollama.chat() stream
  → filterXmlContextTagsFromStream()   ← strips <think>, <context>, etc.
  → VS Code response stream
```

### Provider path (`provider.ts`)

Used when the VS Code LM API routes requests to the Ollama provider (e.g., when another extension or agent selects an Ollama model):

```text
VS Code LM API → OllamaLanguageModelProvider.provideLanguageModelResponse()
  → toOllamaMessages()     ← converts LanguageModelChatMessage[]
  → capability guards:
      - thinking model? → strip <think> from output
      - vision model? → allow LanguageModelDataPart images
      - tools supported? → pass tools; disable on error (isToolsNotSupportedError)
  → ollama.chat() stream
  → token streaming back to VS Code
```

## Stream Parsing

LLM stream handling is composed from focused packages: `@agentsy/context`, `@agentsy/formatting`, `@agentsy/xml-filter`, `@agentsy/thinking`, and `@agentsy/tool-calls`. The source modules `src/formatting.ts`, `src/thinkingParser.ts`, and `src/toolUtils.ts` are thin re-export shims over those stable package exports.

See the [Agentsy package catalog](https://agentsy.self.agency/packages.html) for current package boundaries and stable API surfaces.

## XML Context Tag Handling

VS Code prepends context from open editors, workspace files, and chat participants as XML-like blocks at the start of user messages:

```xml
<vscode_context type="file" path="src/foo.ts">...</vscode_context>
<codebase_context>...</codebase_context>
```

The extension extracts these **only from leading user messages** (never mid-conversation), deduplicates them by tag type (keeping the most recent), and prepends them as a system message. This prevents user text from being elevated to system-message authority.

This is implemented via `splitLeadingXmlContextBlocks` and `dedupeXmlContextBlocksByTag` from `@agentsy/context`.

See: `src/formatting.ts`, `src/provider.ts:610-686`, `src/extension.ts:293-369`

## Model Capability Tracking

`provider.ts` maintains a `visionByModelId` map and detects capabilities per model:

- **Thinking models** (`THINKING_MODEL_PATTERN`): models with `think`, `r1`, `kimi`, etc. in their name — `<think>...</think>` blocks are parsed via `ThinkingParser` from [`@agentsy/thinking`](https://www.npmjs.com/package/@agentsy/thinking) and rendered as collapsible blockquotes before delivery
- **Vision models**: tracked in `visionByModelId`; images are stripped from messages for non-vision models to prevent errors
- **Tools support**: attempted on first request; if the model responds with a tools-not-supported error, tools are disabled for that model for the session

## Sidebar Architecture

### Tree Views

Four separate tree views are registered and each has a dedicated `TreeDataProvider`:

| View           | ID                        | Content                 |
| -------------- | ------------------------- | ----------------------- |
| Local Models   | `ollamaModelsLocalView`   | Installed local models  |
| Running Models | `ollamaModelsRunningView` | Currently loaded models |
| Ollama Library | `ollamaModelsLibraryView` | Public model catalog    |
| Ollama Cloud   | `ollamaModelsCloudView`   | Ollama Cloud models     |
| Modelfiles     | `ollamaModelfilesView`    | Local Modelfiles        |

Views are registered via `window.createTreeView()` so that `TreeView`-specific APIs (`.reveal()`, `.message`, selection events) can be used. The disposables are added to `context.subscriptions`.

### Grouping

Models can be displayed as a flat list or grouped into families. Family detection uses `extractModelFamily()` in `sidebar.ts`, which applies `FAMILY_EXCEPTIONS` for multi-token prefixes (e.g. `gpt-oss`, `open-orca`) and handles short prefixes like `r1` where stripping digits would leave a single character.

Toggle grouping commands use a dual-command pattern:

- `toggleXxxGrouping` — switches from tree to flat (shown when `grouped: true`)
- `toggleXxxGroupingToTree` — delegates back to toggle (shown when `grouped: false`)

### Model Lifecycle

The sidebar calls the Ollama API for:

- `GET /api/tags` — list installed models
- `GET /api/ps` — list running models
- `POST /api/pull` — download a model (streams progress)
- `DELETE /api/delete` — remove a model
- `POST /api/chat` with empty prompt — warm up (start) a model
- `DELETE /api/ps/<name>` — stop (unload) a running model

## Error Handling

- `src/diagnostics.ts` — `DiagnosticsLogger` wraps the VS Code output channel with leveled logging (debug/info/warn/error)
- `src/errorHandler.ts` — `reportError(logger, error, { showToUser })` logs to the output channel and optionally shows a VS Code error notification. Error stacks are logged; user messages are concise.
- `formatError()` in `errorHandler.ts` uses `error.stack ?? error.message` (JS stacks already begin with `Error: <message>`, preventing duplication)

## Security Considerations

- **No shell string interpolation**: all process invocations use argument arrays
- **Auth tokens**: stored in VS Code `SecretStorage`, never in `settings.json` or serialized state
- **Content-Type validation**: HTTP responses from the Ollama Library are validated with `ct.toLowerCase().includes('text/html')` before parsing as JSON
- **XML context scope**: context tags are only extracted from the leading user message block; arbitrary user text cannot be elevated to system scope
