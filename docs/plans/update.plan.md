# Plan: Comprehensive VS Code Chat API Adoption

After comparing the vscode-copilot-chat proposed API surface against opilot's codebase, I identified **11 phases** covering 40+ specific gaps. Here's the full plan:

---

## Phase 1: Proposed API Access — Foundation

_(all other phases depend on this)_

- Add `"enabledApiProposals"` to package.json — currently **completely absent**. Needed entries: `chatParticipantAdditions`, `chatParticipantPrivate`, `defaultChatParticipant`, `languageModelThinkingPart`, `chatStatusItem`, `languageModelCapabilities`
- Expand vscode-ext.d.ts with type declarations for all proposed APIs used in subsequent phases (following existing pattern of module augmentation)
- Run `task compile` to validate no regressions

**Files:** package.json, vscode-ext.d.ts

---

### Phase 2: Rich Chat Response Stream Methods

Many `ChatResponseStream` methods exist but are **never called** — opilot almost exclusively uses `stream.markdown()`:

1. **`stream.usage({ promptTokens, completionTokens })`** — Report token counts after each request. Estimate from `estimateMessagesTokens()` in `contextUtils.ts`
2. **`stream.warning(msg)`** — Replace `stream.markdown('> ⚠️ ...')` patterns with native warning parts
3. **`stream.reference2(uri)`** — Emit file chips when responding about specific files (especially in inline chat context)
4. **`stream.thinkingProgress({ text, id })`** — Replace custom `thinkingParser.ts` XML parsing with the native thinking progress API _(see Phase 3)_
5. **`stream.confirmation(title, message, data)`** + handle `request.acceptedConfirmationData` / `request.rejectedConfirmationData` — Add confirmation dialogs before destructive tool operations (`opilot_stop_model`, `opilot_delete_model`)
6. **`stream.beginToolInvocation(toolCallId, toolName)` / `stream.updateToolInvocation()`** — Currently tool calls may not show the rich streaming "calling tool..." progress UI in chat

**Files:** extension.ts, chatUtils.ts, thinkingParser.ts, toolUtils.ts

---

### Phase 3: Native Thinking Parts (`LanguageModelThinkingPart`)

opilot parses `<think>` XML tags manually. The proposed `languageModelThinkingPart` API provides a native path:

1. Check for `LanguageModelThinkingPart` instances in the LM stream alongside existing `LanguageModelTextPart` checks
2. **Migrate to `LanguageModelChatMessage2`** (proposed) for message history — unlike the current `LanguageModelChatMessage`, `Message2` supports `LanguageModelThinkingPart` in content arrays. This preserves thinking context across multi-turn conversations for qwen3/deepseek-r1 etc.
3. Map Ollama `thinking` field in responses → `stream.thinkingProgress({ text, id })` calls, replacing XML parsing in `thinkingParser.ts`. Keep XML `<think>` as fallback
4. Update `contextUtils.ts` `truncateMessages()` to handle `LanguageModelChatMessage2` arrays including thinking parts
5. Update `chatUtils.ts` to pass thinking parts in assistant messages → Ollama `thinking` field or OpenAI compat `reasoning_content`

**Files:** extension.ts, thinkingParser.ts, chatUtils.ts, contextUtils.ts

---

### Phase 4: Chat Request Context — Inline Chat & Mode Detection

Seven unused `ChatRequest` fields from proposed APIs:

1. **`request.location2`** (`ChatRequestEditorData` | `ChatRequestNotebookData`) — Currently all requests are treated identically. Detect inline editor/notebook/terminal chat and inject the `document`, `selection` context into system prompt automatically
2. **`request.permissionLevel`** — If `'autopilot'` or `'autoApprove'`, skip confirmation dialogs and enable auto-continuation. Currently opilot has `task_complete` but ignores permission level
3. **`request.modeInstructions2`** — Read the active custom Copilot mode's instructions (`.prompt.md` files) and prepend to system prompt, so custom modes work with `@ollama`
4. **`request.editedFileEvents`** — Surface recently-edited files as workspace context
5. **`request.tools` Map** — Switch from `vscode.lm.tools ?? []` (all tools always) to filtering via `request.tools` Map so the tool picker's enable/disable selections are respected
6. **`context.yieldRequested`** — Check in the streaming loop; gracefully stop generation to let VS Code start the follow-up request
7. **`request.acceptedConfirmationData` / `request.rejectedConfirmationData`** — Handle these at handler start to process confirmation outcomes

**Files:** extension.ts, contextUtils.ts

---

### Phase 5: Chat Participant Enhancements

Seven unused `ChatParticipant` features:

1. **`participant.titleProvider`** — Generate conversation titles by sending a short prompt to Ollama ("Summarize in 5–8 words: [first message]")
2. **`participant.summarizer`** — Compress long conversation history by asking Ollama to summarize, reducing tokens in multi-turn sessions
3. **`participant.helpTextPrefix`** — Add markdown description of @ollama capabilities to `/help` output
4. **`participant.additionalWelcomeMessage`** — Show server status + active model on first open: "Connected to localhost:11434 · llama3.2:3b · 4 models available"
5. **`participant.followupProvider`** — Suggest 2–3 follow-up prompts after each response (contextual heuristics: "Apply to file?", "Explain further?", "Run in terminal?")
6. **`participant.participantVariableProvider`** — Provide `@ollama:llama3.2` model selector completions. `provideCompletionItems()` returns one `ChatCompletionItem` per available model; handler reads the selected model variable and overrides `request.model`
7. **`vscode.chat.registerChatParticipantDetectionProvider()`** — Teach VS Code when to auto-route to `@ollama`: match keywords "ollama", "local model", "llama", "mistral", etc.

New file: `src/participantFeatures.ts`
**Files:** extension.ts, new `src/participantFeatures.ts`

---

### Phase 6: Chat Status Item (In-Chat Indicator)

opilot shows Ollama status in the VS Code **status bar** but NOT inside the **chat panel** itself.

1. Call `vscode.window.createChatStatusItem('opilot.serverStatus')` (proposed, guard with availability check)
2. Set `title = 'Ollama'`, `description = 'Connected · llama3.2:3b'` or `'Offline'`
3. Wire to the same health-check timer in `statusBar.ts`
4. This is **additive** — the existing status bar entry remains

New file: `src/chatStatusItem.ts` or extend statusBar.ts

---

### Phase 7: Agent Mode — Inline File Editing

The single biggest missing feature: `@ollama` **cannot edit files** like Copilot agent mode can.

1. Gate behind new `opilot.agentMode` setting (boolean, default false) — this is a significant behavior change
2. Detect agent-mode requests: `request.permissionLevel === 'autopilot'`, or `#file`/`#selection` references, or explicit "edit this file" intent
3. Parse model response for fenced code blocks, map them to active editor URI
4. Call `stream.textEdit(uri, [TextEdit.replace(fullRange, newCode)])` then `stream.textEdit(uri, true)` (isDone)
5. For file creation/deletion: `stream.workspaceEdit([{ newResource: uri }])` / `stream.workspaceEdit([{ oldResource: uri }])`
6. Confirmation before destructive edits: `await stream.confirmation(...)`, handle `request.acceptedConfirmationData` on follow-up
7. Update `contextUtils.ts` system prompt for agent mode: include current file content, instruct model to emit code blocks with filename headers

New file: `src/agentMode.ts`
**Files:** extension.ts, contextUtils.ts, package.json

---

### Phase 8: Tool Invocation Improvements

1. **`stream.beginToolInvocation()` / `stream.updateToolInvocation()`** — Show "calling opilot_list_models..." with streaming arguments in chat UI before tool completes
2. **`ExtendedLanguageModelToolResult`** — Use for richer tool results with `toolResultMessage`, `toolResultDetails: Array<Uri | Location>`, `hasError` flag. Currently results are plain strings
3. **`LanguageModelToolInformation.source`** — Check if tool is `LanguageModelToolMCPSource` vs `LanguageModelToolExtensionSource`; differentiate MCP tools in logs/filtering
4. **`PreparedToolInvocation`** on opilot's registered tools — Implement `prepareInvocation()` on `opilot_list_models`, `opilot_pull_model`, etc. to return `{ invocationMessage: 'Listing models...', pastTenseMessage: 'Listed models' }` for better chat UI labels

**Files:** extension.ts, toolUtils.ts, contextUtils.ts

---

### Phase 9: Chat Session Customization Provider

Surface Modelfiles in VS Code's built-in customization management UI:

1. Implement `ChatSessionCustomizationProvider` scanning modelfiles folder via `getModelfilesFolder()` from `modelfiles.ts`
2. Return `ChatSessionCustomizationItem[]` — one per Modelfile, with `type: ChatSessionCustomizationType.Agent` and `uri` pointing to the `.modelfile` file
3. Register via `vscode.chat.registerChatSessionCustomizationProvider('opilot', { label: 'Ollama Modelfiles', iconId: 'hubot' }, provider)`
4. Fire `onDidChange` via a `vscode.workspace.createFileSystemWatcher` on the modelfiles directory

New file: `src/chatCustomizationProvider.ts`

---

### Phase 10: Context Keys for Conditional UI

Currently only filter-state context keys exist. Add:

1. `ollama.serverOnline` (bool) — set in status bar health check; enables menu items that require Ollama to be running
2. `ollama.activeModel` (string) — currently selected/running model
3. `ollama.agentModeEnabled` (bool) — from `opilot.agentMode` setting

Use in package.json `menus` → `when` clauses for conditional command visibility.

**Files:** statusBar.ts, extension.ts, package.json

---

### Phase 11: ChatResult Improvements

1. **`result.nextQuestion`** — After each response, return a suggested follow-up from `handleChatRequest()`. Heuristic: code response → "Would you like to apply these changes?"; model list → "Would you like to pull one of these?"
2. **`result.details`** — Include a brief summary: "Model: llama3.2:3b · 847 prompt / 312 completion tokens · 2.3s"

**Files:** extension.ts

---

### Relevant Files

| File                                       | Changes                                                         |
| ------------------------------------------ | --------------------------------------------------------------- |
| package.json                               | `enabledApiProposals`, new settings, context key `when` clauses |
| vscode-ext.d.ts                            | Proposed API type declarations                                  |
| extension.ts                               | All phases touch this                                           |
| chatUtils.ts                               | Phase 3 (Message2), Phase 2 (stream methods)                    |
| contextUtils.ts                            | Phase 3 (Message2 truncation), Phase 4, Phase 7                 |
| thinkingParser.ts                          | Phase 3 (replace XML with native API)                           |
| toolUtils.ts                               | Phase 8                                                         |
| statusBar.ts                               | Phase 6, Phase 10                                               |
| modelfiles.ts                              | Phase 9 (provider wiring)                                       |
| `src/participantFeatures.ts` _(new)_       | Phase 5                                                         |
| `src/agentMode.ts` _(new)_                 | Phase 7                                                         |
| `src/chatCustomizationProvider.ts` _(new)_ | Phase 9                                                         |
| `src/chatStatusItem.ts` _(new)_            | Phase 6                                                         |

---

### Verification

1. `task compile` — zero TS errors with proposed types
2. `task unit-tests` — all existing pass; add tests for `participantFeatures.ts`, `agentMode.ts`
3. `task lint` — no violations
4. **Manual (F5):** Welcome message, in-chat status item, conversation title generation
5. **Manual:** Inline file editing in agent mode on test TypeScript file
6. **Manual:** Confirmation dialog before destructive tool calls (`opilot_stop_model`)
7. **Manual:** `@ollama:llama3.2` variable completions in chat input
8. **Manual:** Native thinking progress (not blockquote) for qwen3/deepseek-r1

---

### Decisions & Considerations

- **Proposed API stability:** Several APIs (`chatParticipantAdditions`, `chatParticipantPrivate`) are proposed. Use `typeof api !== 'undefined'` guards everywhere for graceful degradation on older VS Code. Marketplace publishing of proposed APIs requires special permissions — audit each API's graduation status with `@vscode/dts` before shipping
- **Agent mode is feature-flagged:** Gated behind `opilot.agentMode` (default off) due to the behavior change significance
- **`participant.titleProvider` overhead:** Each conversation generates an extra Ollama request. Cache after first generation; debounce so it doesn't fire on every message
- **Out of scope:** MCP server integration, dynamic per-model participants
