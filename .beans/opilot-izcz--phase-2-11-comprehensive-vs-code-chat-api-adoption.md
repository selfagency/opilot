---
# opilot-izcz
title: 'Phase 2-11: Comprehensive VS Code Chat API Adoption'
status: todo
type: epic
priority: high
created_at: 2026-05-03T19:02:47Z
updated_at: 2026-05-03T19:02:47Z
id: opilot-izcz
---

## Overview

Implement all remaining phases (2-11) of the comprehensive VS Code Chat API adoption plan for the opilot extension. This epic builds on Phase 1 (LanguageModel API) to fully leverage the Chat API for enhanced functionality.

## Phases

### Phase 2: Rich Chat Response Stream Methods

Implement advanced response streaming capabilities:

- `stream.warning()` - Send warning messages in chat
- `stream.reference()` / `reference2()` - Add rich references to responses
- `stream.thinkingProgress()` - Stream thinking progress updates
- `stream.confirmation()` - Request user confirmations inline
- `stream.textEdit()` - Stream text edits for inline code changes
- `stream.workspaceEdit()` - Stream workspace-level edits

### Phase 3: Native Thinking Parts

Integrate native thinking support:

- `LanguageModelThinkingPart` - Support thinking parts from language models
- `Message2` - New message format with thinking support
- Map `thinkingProgress` events to thinking parts
- Handle thinking budget and progress tracking

### Phase 4: Chat Request Context

Enhance request context with:

- `location2` - Improved location tracking in chats
- `permissionLevel` - Track user permission context
- `modeInstructions2` - Enhanced mode-specific instructions
- `editedFileEvents` - Track file edit events in conversation
- `tools` as Map - Improved tool invocation handling
- `yieldRequested` - Handle yield/pause requests from user

### Phase 5: Chat Participant Enhancements

Create `participantFeatures.ts` with:

- `titleProvider` - Dynamic participant title
- `summarizer` - Conversation summarization
- `helpTextPrefix` - Customizable help text
- `additionalWelcomeMessage` - Extended welcome info
- `followupProvider` - Intelligent followup suggestions
- `participantVariableProvider` - Support for @variable patterns

### Phase 6: Chat Status Item

Implement `chatStatusItem.ts`:

- `createChatStatusItem()` - Create status items for chat
- Display status info inline within chat messages
- Update status based on model availability and operations

### Phase 7: Agent Mode

Implement `agentMode.ts`:

- Enable agent mode for the @ollama participant
- Support inline file editing with `stream.textEdit()`
- Manage multi-turn agent workflows
- Handle tool invocations and confirmations

### Phase 8: Tool Invocation Improvements

Enhance tool handling:

- `ExtendedLanguageModelToolResult` - Extended tool result format
- Tool source differentiation - distinguish built-in vs custom tools
- `PreparedToolInvocation` - Pre-validated tool calls
- Improve error handling and tool result streaming

### Phase 9: Chat Session Customization

Create `chatCustomizationProvider.ts`:

- Allow Modelfiles to customize chat behavior
- Support per-model system prompts and parameters
- Enable custom tool definitions
- Handle model-specific configurations

### Phase 10: Context Keys

Add VS Code context keys:

- `ollama.serverOnline` - Track Ollama server availability
- `ollama.activeModel` - Current active model
- `ollama.agentModeEnabled` - Agent mode toggle
- Enable conditional command visibility/enablement

### Phase 11: ChatResult Improvements

Enhance ChatResult with:

- `nextQuestion` - Suggest next user questions
- `details` - Provide additional details/links
- Support markdown formatting in results
- Improve result presentation in chat UI

## Requirements

- **Compilation:** All phases must compile with 0 TypeScript errors
- **Tests:** All existing tests must continue passing
- **New Tests:** Add tests for new functionality in Phases 5, 6, 7, 9
- **Manual Verification:** Test extension via F5 (VS Code Extension Development Host)
- **Branch:** `feat/vscode-chat-api-adoption` (create after PR #101 merges)

## Todo

- [ ] Phase 2: Rich Chat Response Stream Methods implementation
- [ ] Phase 3: Native Thinking Parts support
- [ ] Phase 4: Chat Request Context enhancements
- [ ] Phase 5: Chat Participant Enhancements (with tests)
- [ ] Phase 6: Chat Status Item implementation (with tests)
- [ ] Phase 7: Agent Mode implementation (with tests)
- [ ] Phase 8: Tool Invocation Improvements
- [ ] Phase 9: Chat Session Customization (with tests)
- [ ] Phase 10: Context Keys implementation
- [ ] Phase 11: ChatResult Improvements
- [ ] Run full test suite: `task unit-tests`
- [ ] Run integration tests: `task integration-tests`
- [ ] Manual verification with F5
- [ ] TypeScript compilation check: `task check-types`
- [ ] Create PR with all phases completed

## Implementation Notes

- Follow existing code patterns in `src/` directory
- Use MSW for HTTP mocking in unit tests (see src/mocks/handlers.ts)
- Add 85%+ test coverage for new modules
- Update documentation in `docs/developers/` as needed
- Consider backward compatibility with VS Code Chat API versions

## Related

- Depends on: Phase 1 (LanguageModel API adoption)
- Blocks: Chat API feature completeness
