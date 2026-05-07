# Copilot Instructions for This Repository

## Operating style

- Be terse, direct, and technical. Avoid filler, hedging, and long explanations unless the user asks for them.
- Prefer the repository's actual patterns, naming, architecture, and versions over generic best practices.
- Inspect the codebase before editing. Do not invent APIs or architecture.
- Make the smallest safe change that solves the problem.

## Project context

- This is a TypeScript-based Visual Studio Code extension.
- It integrates Ollama models into Copilot Chat.
- Use the official VS Code Extension API docs and the `microsoft/vscode-copilot-chat` codebase as primary references for extension behavior, chat UX, and supported patterns.
- Use the Ollama API docs and `ollama-js` as the source of truth for model access, chat, streaming, base URLs, and client configuration.
- Use the `@agentsy` framework for agent orchestration, streaming-first handling, and type-safe contracts.

## Implementation rules

- Follow the repo's actual code conventions, scripts, folder layout, and test setup.
- Keep extension activation lightweight and deterministic.
- Use strong TypeScript types, narrow interfaces, and explicit error handling.
- Preserve streaming, cancellation, and partial-result behavior end to end.
- Treat model outputs, tool outputs, and external inputs as untrusted.
- Never hardcode secrets, tokens, or private endpoints.
- Prefer documented extension points over private or brittle internals.
- Keep prompts, tool schemas, and command handlers minimal and explicit.

## Ollama integration

- Use `ollama-js` unless the repository already standardizes on a different client layer.
- Prefer the official `ollama` package for JavaScript/TypeScript integration.
- Support streaming with `stream: true` when the UI or agent flow needs incremental output.
- Validate model names, base URLs, custom headers, and client options through typed configuration.
- Support both local and cloud Ollama endpoints only if the repository requires it.
- Keep fallback behavior clear when a model, tool, or stream fails.
- Assume the Ollama API is stable but not strictly versioned; avoid hardcoding brittle request shapes unless the docs require them.

## VS Code extension guidance

- Use official extension docs for activation events, commands, configuration, webviews, workspace access, and testing.
- Mirror behavior from `microsoft/vscode-copilot-chat` when implementing chat participants, tool wiring, agent-mode behavior, or UX details.
- Prefer APIs that are supported in the current VS Code release track used by the repository.
- When in doubt, check the VS Code docs and the extension codebase before changing behavior.

## Agentsy guidance

- Use `@agentsy` for multi-step workflows, stream normalization, and structured recovery.
- Keep agent orchestration explicit and observable.
- Validate every tool call and every model-produced payload before side effects.
- Use typed contracts for inputs, outputs, and intermediate state.
- Design for composability and future MCP tool expansion.

## MCP and tool policy

- Always use `git-mcp` for git operations, including status, branch, add, commit, diff, merge, rebase, tag, and related repo actions.
- Always use GitHub MCP for pull request operations, including create, update, review, merge, close, reopen, and PR metadata.
- Do not use raw shell `git` or `gh` when MCP coverage exists.
- If the needed git or GitHub action is not available through MCP, stop and document the gap instead of improvising with unsafe shell commands.

## Quality gates

- Before shipping any commit, run the project's type check, linter, and tests.
- Do not consider work complete until all three are passing.
- If a gate fails, fix the failure or clearly explain the blocker.
- Add or update tests for any behavior change.

## Change discipline

- Keep commits small and reviewable.
- Avoid unrelated refactors.
- Preserve backward compatibility unless a breaking change is explicitly required.
- Update docs and examples when behavior changes.
- Verify the extension builds and runtime behavior matches expectations.

## References

- VS Code Extension API: [Source](https://code.visualstudio.com/api)
- VS Code API reference: [Source](https://code.visualstudio.com/api/references/vscode-api)
- VS Code Copilot Chat codebase: [Source](https://github.com/microsoft/vscode-copilot-chat)
- Ollama API docs: [Source](https://docs.ollama.com/api/introduction)
- Ollama JS client: [Source](https://github.com/ollama/ollama-js)
- Agentsy framework: [Source](https://agentsy.self.agency/)
