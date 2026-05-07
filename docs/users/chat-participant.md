---
title: '@ollama Chat Participant'
---

The `@ollama` chat participant provides a dedicated, history-aware conversational interface to your local Ollama models inside GitHub Copilot Chat.

## Invoking `@ollama`

Type `@ollama` at the beginning of any Copilot Chat message:

```text
@ollama explain the architecture of this TypeScript project
```

The participant is **sticky** — once invoked in a conversation thread, it continues handling subsequent messages automatically until you switch to a different participant.

## How It Differs from the Model Picker

|               | Model Picker                | `@ollama`                                   |
| ------------- | --------------------------- | ------------------------------------------- |
| Invocation    | Select from dropdown        | `@ollama` prefix                            |
| Sticky        | Thread model stays selected | Yes, participant stays selected             |
| Default model | Most recently selected      | `ollama.completionModel` or first available |
| Tool calling  | Yes                         | Yes                                         |

## Disambiguation & Routing

Opilot integrates with VS Code's model picker and the `@ollama` chat participant. A few routing behaviors to be aware of:

- Non-tool models (models without tool-calling capability) are surfaced under the "Ask" category in the model picker. Use these for straightforward Q&A and conversational prompts.
- Tool-capable models (models that support function/tool calling) are available in all picker modes (Agent, Edit, Ask) so they can be selected for agentic workflows.
- Typing `@ollama` in a Copilot Chat input explicitly routes that thread to the Opilot Ollama participant — this is useful when you want to ensure the Ollama participant is used regardless of the global picker selection.
- The extension attempts to auto-detect and label models with capabilities (thinking, tools, vision) and exposes those labels as badges in the sidebar and the model picker to help disambiguation.

If you have questions about how a particular model will be routed for a prompt, check the model's capability badges in the sidebar or use `opilot_get_model_info` (if tools are enabled) to programmatically inspect capabilities.

## Context and History

The `@ollama` participant passes the full conversation history from Copilot Chat to Ollama in each request, so it maintains context across turns:

```text
@ollama what does the `activate` function do in this file?
# (reads through the response)
How does it handle errors?
# (follow-up — still using @ollama with full context)
```

## Workspace Context

When VS Code provides workspace context (open files, selected code, terminal output), it is injected as XML-tagged context blocks at the beginning of the conversation. The extension extracts these tags and promotes them to a system message, so they influence replies without cluttering the conversation view.

## Tool Calling

For models with tool-calling capability (🛠 badge), the `@ollama` participant can invoke VS Code tools:

```text
@ollama look at the test file for sidebar.ts and tell me what cases are missing
```

The tool loop runs inside the extension — the model emits tool call requests, VS Code executes them, and the results flow back for the next response turn. If a model rejects the tool schema (not all models support OpenAI-compatible function calling), the extension automatically retries the request without tools.

## Vision

For models with vision capability (👁 badge), you can attach images directly in the chat input:

- Drag an image file into the chat input
- Paste an image from clipboard

```text
@ollama what is shown in this screenshot?
[image attached]
```

Images are automatically stripped for models that do not support vision, so you can leave images in your message history without worrying about errors.

## Thinking Models

For models that expose chain-of-thought reasoning (🧠 badge — DeepSeek-R1, Qwen QwQ, Kimi, etc.), responses are split into two collapsible sections:

- **Thinking** — the model's internal reasoning, wrapped in `<think>…</think>` tags
- **Response** — the final answer

This makes it easy to review the reasoning or skip straight to the answer.

## Streaming

Responses stream token-by-token in real time. The extension uses an XML stream filter to safely handle model responses that may emit XML-like system tags inside their output, ensuring they are rendered as plain text rather than being interpreted as injected context.

## Error Handling

| Situation                  | Behavior                                                   |
| -------------------------- | ---------------------------------------------------------- |
| Ollama unreachable         | Error message with "Open Settings" and "Open Logs" options |
| Model not found            | Error with model name; use sidebar to pull model           |
| Tool schema rejected       | Automatic retry without tools                              |
| Model crash / OOM detected | Warning dialog with model name and "Open Logs" option      |
| Rate limit (cloud models)  | Error surfaced in chat                                     |
