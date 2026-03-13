# Plan: `llm-stream-parser` — Standalone LLM Response Parser

## 1. Rationale

The parsing logic in Opilot solves a genuinely portable problem: LLMs emit heterogeneous output (thinking tokens, XML tool calls, JSON-wrapped tool calls, injected context tags, markdown fences, structured JSON wrapped in prose) and no existing library cleanly handles all of it across streaming and non-streaming paths without pulling in a full framework. Extracting it creates a reusable primitive other VS Code extension authors and Node.js developers can consume.

A survey of prior art (Vercel AI SDK, Anthropic SDK, OpenAI Node SDK, LangChain, llm-output-parser, langschema, Microsoft Agent Framework, instructor) reveals that while each solves part of the problem, none provides a single lightweight package that covers streaming think-tag parsing, XML tool call extraction, structured JSON output parsing with validation, context-tag scrubbing, and composable parser pipelines — all without importing a provider SDK. This plan incorporates the best ideas from each.

---

## 2. Scope: What Extracts vs What Stays

### Extracts into the library

| Module                                                           | Source file       |
| ---------------------------------------------------------------- | ----------------- |
| `ThinkingParser` — streaming `<think>`/`</think>` splitter       | thinkingParser.ts |
| `XmlStreamFilter` — SAX context-tag scrubber                     | formatting.ts     |
| `extractXmlToolCalls` — bare XML + JSON-wrapped format           | toolUtils.ts      |
| `cleanXml` — markdown fence / prose stripping (internal helper)  | toolUtils.ts      |
| `buildXmlToolSystemPrompt` — few-shot XML prompt builder         | toolUtils.ts      |
| `splitLeadingXmlContextBlocks` / `dedupeXmlContextBlocksByTag`   | formatting.ts     |
| `sanitizeNonStreamingModelOutput` / `stripXmlContextTags`        | formatting.ts     |
| `formatXmlLikeResponseForDisplay` — XML→markdown formatter       | formatting.ts     |
| `appendToBlockquote` — streaming markdown blockquote helper      | provider.ts       |
| `LLMStreamProcessor` — orchestration class (new)                 | —                 |
| Adapters: VS Code, generic async iterable                        | —                 |
| `parseJson` — extract JSON from prose/markdown fences (new)      | —                 |
| `validateJsonSchema` — validate parsed JSON against schema (new) | —                 |
| `buildFormatInstructions` — schema → prompt instructions (new)   | —                 |
| `buildRepairPrompt` — failed parse → re-prompt helper (new)      | —                 |

### Stays in Opilot

- Ollama-specific retry/rescue ladder (`isThinkingNotSupportedError`, `isThinkingInternalServerError`)
- `isThinkingModelId` / `THINKING_MODEL_PATTERN` (Opilot-specific heuristic)
- Tool ID mapping (`generateToolCallId`, `mapToolCallId`)
- VS Code–specific `progress.report(new LanguageModelTextPart(...))` calls
- All sidebar/provider/extension wiring

---

## 3. Package Identity

```text
llm-stream-parser
```

Published under the `@opilot` npm organization. MIT license. One runtime dependency (`saxophone`). Typescript-first, dual ESM + CJS build via `tsup`. Subpath exports for tree-shaking (see Section 10).

---

## 4. Package Structure

```text
packages/llm-stream-parser/
  src/
    thinking/
      ThinkingParser.ts          # streaming <think>/<|thinking|>/etc. splitter
      index.ts
    xml-filter/
      XmlStreamFilter.ts         # SAX streaming context-tag scrubber
      tagLists.ts                # built-in scrub sets: VSCODE_CONTEXT_TAGS, SYSTEM_WRAPPER_TAGS
      index.ts
    tool-calls/
      extractXmlToolCalls.ts     # bare <tool_name><param>val</param></tool_name>
      extractJsonWrappedCalls.ts # <toolCall>{"name":...}</toolCall> / determinate
      buildXmlToolSystemPrompt.ts
      index.ts
    context/
      splitLeadingXmlContext.ts
      dedupeXmlContext.ts
      index.ts
    structured/
      parseJson.ts               # extract JSON from LLM prose/markdown fences
      validateJsonSchema.ts      # validate parsed JSON against JSON Schema
      buildFormatInstructions.ts  # generate prompt instructions from schema
      buildRepairPrompt.ts       # generate re-prompt from failed parse + error
      index.ts
    processor/
      LLMStreamProcessor.ts      # orchestration class combining all the above
      AccumulatedMessage.ts      # full message accumulator across all chunks
      index.ts
    markdown/
      appendToBlockquote.ts      # streaming markdown blockquote helper
      index.ts
    adapters/
      vscode.ts                  # GitHub Copilot Chat / VS Code LM API
      generic.ts                 # plain AsyncIterable<StreamChunk>
    index.ts                     # all public exports
  test/
    thinking.test.ts
    xmlFilter.test.ts
    toolCalls.test.ts
    structured.test.ts
    processor.test.ts
    accumulator.test.ts
    adapters/vscode.test.ts
  package.json
  tsconfig.json
  tsup.config.ts
```

---

## 5. Core API Design

### 5a. Low-level primitives (framework-free)

These are direct ports with improved generics:

```typescript
// thinking/ThinkingParser.ts
export class ThinkingParser {
  constructor(options?: { openingTag?: string; closingTag?: string });
  addContent(chunk: string): [thinkingContent: string, regularContent: string];
  reset(): void;
}

// xml-filter/XmlStreamFilter.ts
export interface XmlStreamFilter {
  write(chunk: string): string;
  end(): string;
}
export function createXmlStreamFilter(options?: {
  /** Tags to scrub IN ADDITION to the built-in privacy/context defaults. */
  extraScrubTags?: Set<string>;
  /** Fully override the scrub set. Caution: omitting privacy-sensitive tags
   *  (user_info, userData, etc.) may leak private data into model output. */
  overrideScrubTags?: Set<string>;
}): XmlStreamFilter;
// Default scrub set: VSCODE_CONTEXT_TAGS ∪ SYSTEM_WRAPPER_TAGS ∪ PRIVACY_TAGS

// tool-calls/extractXmlToolCalls.ts
export interface XmlToolCall {
  name: string;
  parameters: Record<string, unknown>;
  format: 'bare-xml' | 'json-wrapped'; // lets consumer know which format was used
}
export function extractXmlToolCalls(text: string, knownTools: Set<string>): XmlToolCall[];
// handles both bare XML and <toolCall>JSON</toolCall> transparently
```

The key improvement during extraction: merge `extractXmlToolCalls` and the new JSON-wrapper path into one function — consumer doesn't need to care which format the model chose.

### 5b. Orchestration class

```typescript
// processor/LLMStreamProcessor.ts
export interface StreamChunk {
  content?: string;
  thinking?: string;
  tool_calls?: Array<{ function: { name: string; arguments: unknown } }>;
  done?: boolean;
}

export interface ProcessorOptions {
  parseThinkTags?: boolean; // default: true  — runs ThinkingParser on content
  scrubContextTags?: boolean; // default: true  — runs XmlStreamFilter on content
  extraScrubTags?: Set<string>; // additional tags to scrub on top of defaults
  overrideScrubTags?: Set<string>; // fully replace the scrub set (caution: may leak private data)
  knownTools?: Set<string>; // if set, activates XML tool call extraction on non-streaming
  thinkingOpenTag?: string; // default: '<think>'
  thinkingCloseTag?: string; // default: '</think>'
  thinkingTagMap?: Map<string, [string, string]>; // model-id → [openTag, closeTag] overrides
  onWarning?: (message: string, context?: Record<string, unknown>) => void;
  maxInputLength?: number; // max response chunk size in chars; truncates with warning
}

export interface ProcessedOutput {
  thinking: string; // thinking content delta for THIS chunk only (not accumulated)
  content: string; // clean content delta for this chunk
  toolCalls: XmlToolCall[];
  done: boolean;
}

export class LLMStreamProcessor {
  constructor(options?: ProcessorOptions);
  /** Process a single streaming chunk. Returns deltas, not accumulated state. */
  process(chunk: StreamChunk): ProcessedOutput;
  /** Process a complete (non-streaming) response in one call. */
  processComplete(response: StreamChunk): ProcessedOutput;
  /** Flush SAX buffer at end of stream. Must be called after the last process(). */
  flush(): ProcessedOutput;
  /** Read-only accumulated thinking content across all chunks. */
  get accumulatedThinking(): string;
  reset(): void;
}
```

### 5c. `StreamChunk` — canonical input type

`StreamChunk` is the library's canonical input shape. Callers using non-Ollama providers must map their chunks into it:

```typescript
// OpenAI-compatible mapping example:
const chunk: StreamChunk = {
  content: delta.content ?? undefined,
  thinking: delta.reasoning ?? undefined,
  tool_calls: delta.tool_calls?.map(tc => ({
    function: { name: tc.function.name, arguments: JSON.parse(tc.function.arguments) },
  })),
  done: choice.finish_reason != null,
};
```

The library does NOT import or depend on any provider SDK. Mapping is the caller's responsibility.

### 5d. Structured output parsing (new)

Inspired by LangChain output parsers, llm-output-parser, langschema, and Vercel AI SDK's `Output.object()`.

```typescript
// structured/parseJson.ts
export interface ParseJsonOptions {
  /** When multiple JSON objects found, return the most comprehensive one. Default: true */
  selectMostComprehensive?: boolean;
  /** Attempt to recover incomplete/truncated JSON (unclosed brackets). Default: false */
  repairIncomplete?: boolean;
}

/**
 * Extract and parse JSON from LLM output text.
 * Handles: markdown ```json fences, prose wrapping, multiple objects.
 * Returns null if no valid JSON found (does not throw).
 */
export function parseJson(text: string, options?: ParseJsonOptions): unknown | null;

/**
 * Parse JSON from text and validate against a JSON Schema.
 * Returns { success: true, data } or { success: false, errors }.
 * No required runtime dependency on Zod — consumers can supply Ajv/Zod-backed validation.
 */
export function validateJsonSchema<T = unknown>(
  text: string,
  schema: Record<string, unknown>,
  options?: ParseJsonOptions
): { success: true; data: T } | { success: false; errors: string[] };

// structured/buildFormatInstructions.ts
/**
 * Given a JSON Schema object, generate natural-language prompt instructions
 * that guide the LLM to output valid JSON matching the schema.
 * Inspired by LangChain's `get_format_instructions()`.
 */
export function buildFormatInstructions(schema: Record<string, unknown>): string;

// structured/buildRepairPrompt.ts
/**
 * Given a failed output and the parse error, build a re-prompt that asks the
 * LLM to fix its malformed output. The caller makes the actual LLM call.
 * Inspired by LangChain's OutputFixingParser.
 * No network access — pure prompt construction.
 */
export function buildRepairPrompt(options: {
  failedOutput: string;
  error: string;
  schema?: Record<string, unknown>;
  originalPrompt?: string;
}): string;
```

**Design decisions**:

- `parseJson` strips markdown fences, leading/trailing prose, and selects the most comprehensive object when multiple are found (from llm-output-parser).
- Optional `repairIncomplete` mode attempts to close unclosed brackets/braces for truncated responses.
- Schema validation uses JSON Schema (not Zod) as the interchange format. The library ships with a narrow built-in subset validator for common constraints, and optionally accepts an injected validator adapter for full JSON Schema support.
- `buildFormatInstructions` generates human-readable text like LangChain's `get_format_instructions()` but for JSON Schema directly.
- `buildRepairPrompt` is a pure function (no network). It constructs a prompt showing the LLM its failed output + the error + the schema, asking it to produce corrected output.

### 5e. Event-based streaming (new)

Inspired by Anthropic SDK's streaming helpers (`.on('text', cb)`).

```typescript
// processor/LLMStreamProcessor.ts — additional methods
export type StreamEventMap = {
  text: (delta: string) => void;
  thinking: (delta: string) => void;
  tool_call: (call: XmlToolCall) => void;
  done: () => void;
  warning: (message: string, context?: Record<string, unknown>) => void;
};

// On the LLMStreamProcessor class:
  on<K extends keyof StreamEventMap>(event: K, listener: StreamEventMap[K]): this;
  off<K extends keyof StreamEventMap>(event: K, listener: StreamEventMap[K]): this;
```

Event callbacks fire synchronously during `process()` and `flush()` calls. This provides an alternative consumption model to `ProcessedOutput` return values — useful for consumers that want to wire callbacks once and push chunks without inspecting return values (e.g., Anthropic SDK's `.on('text', ...)` pattern).

### 5f. Message accumulation (new)

Inspired by Anthropic SDK's `stream.finalMessage()`.

```typescript
// processor/AccumulatedMessage.ts
export interface AccumulatedMessage {
  /** All thinking content concatenated across all chunks. */
  thinking: string;
  /** All clean content concatenated across all chunks. */
  content: string;
  /** All tool calls collected across all chunks, in order. */
  toolCalls: XmlToolCall[];
}

// On the LLMStreamProcessor class:
  /** Read-only accumulated message across all processed chunks. */
  get accumulatedMessage(): AccumulatedMessage;
```

The existing `accumulatedThinking` getter is subsumed by `accumulatedMessage.thinking`. Both are kept for backward compat during 0.x.

### 5g. Discriminated output parts (new)

Inspired by provider SDKs that expose discriminated output/content blocks.

```typescript
export type OutputPart =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_call'; call: XmlToolCall };

// On ProcessedOutput — optional parts array for pattern-matching consumption:
export interface ProcessedOutput {
  // ... existing fields ...
  /** Discriminated parts for pattern-matching. Order matches emission order. */
  parts: OutputPart[];
}
```

The flat `thinking`/`content`/`toolCalls` fields remain for backward compat and simple use cases. `parts` enables a cleaner switch-style consumption pattern:

```typescript
for (const part of output.parts) {
  switch (part.type) {
    case 'text': stream.markdown(part.text); break;
    case 'thinking': blockquote(part.text); break;
    case 'tool_call': await executeTool(part.call); break;
  }
}
```

### 5h. Composable parser pipeline (new)

Inspired by LangChain's `BaseOutputParser` chaining and Vercel AI SDK's function composition.

```typescript
// Re-export from index.ts
export type Parser<In, Out> = (input: In) => Out;

/**
 * Compose two parsers: pipe(a, b) returns a parser that runs a then b.
 * Enables: pipe(parseJson, validateSchema(mySchema))
 */
export function pipe<A, B, C>(first: Parser<A, B>, second: Parser<B, C>): Parser<A, C>;
export function pipe<A, B, C, D>(
  first: Parser<A, B>,
  second: Parser<B, C>,
  third: Parser<C, D>
): Parser<A, D>;
```

This is intentionally minimal — functional composition, not a class hierarchy. Parsers are plain functions. Example usage:

```typescript
import { parseJson, pipe } from 'llm-stream-parser';

const parseAndValidate = pipe(
  (text: string) => parseJson(text),
  (json) => myZodSchema.parse(json)
);
const result = parseAndValidate(llmOutput);
```

### 5i. Adapters

Ship two adapters in `0.x`. Additional adapters (Vercel, Anthropic, LangChain) are candidates for later minor releases when there is real demand — shipping them now creates a maintenance burden of tracking upstream SDK type changes.

Design inspirations (applied to the generic adapter, not as separate adapters):

- **Vercel AI SDK** — async generator transformation pattern
- **Anthropic SDK** — typed `ThinkingBlock` / `TextBlock` discrimination
- **LangChain.js** — `BaseOutputParser` composability

```typescript
// adapters/vscode.ts
// Takes a vscode.Progress or stream.markdown sink, routes thinking/content/tools
export function createVSCodeCopilotAdapter(options: {
  processor: LLMStreamProcessor
  stream: VSCodeChatStream    // { markdown(s: string): void } or progress.report-alike
  onToolCall: (call: XmlToolCall) => void | Promise<void>
  showThinking?: boolean
}): {
  write(chunk: StreamChunk): Promise<void>
  end(): Promise<void>
}

// adapters/generic.ts
// Async generator — works in extension host, Node.js, browsers, edge runtimes
export async function* processStream(
  source: AsyncIterable<StreamChunk>,
  options?: ProcessorOptions
): AsyncGenerator<ProcessedOutput>
```

---

## 6. Improvements Made During Extraction

### Configurable scrub tag sets (privacy-safe by default)

Currently `OUTPUT_SCRUB_TAG_NAMES` is hardcoded in formatting.ts. The library exposes:

- `VSCODE_CONTEXT_TAGS` — VS Code-injected only (`environment_info`, `user_info`, etc.)
- `PRIVACY_TAGS` — tags containing private user data (`user_info`, `userData`, `userPreferences`, `userMemory`, `sessionMemory`, `repository_memories`)
- `SYSTEM_WRAPPER_TAGS` — the broader meta-wrapper set
- `DEFAULT_SCRUB_TAGS` — `VSCODE_CONTEXT_TAGS ∪ SYSTEM_WRAPPER_TAGS ∪ PRIVACY_TAGS` (current behaviour)

The `extraScrubTags` option **adds to** the defaults. A separate `overrideScrubTags` option fully replaces them but logs a warning via `onWarning` if `PRIVACY_TAGS` are not included, to prevent accidental data leakage.

### Unified tool call extraction

Merge the bare-XML path and the `<toolCall>JSON</toolCall>` path. The merged `extractXmlToolCalls` checks for JSON-object content inside generic wrapper tags first, then falls through to named-tag extraction. Returns `XmlToolCall[]` with a `format` discriminant so callers can observe which format the model used (useful for logging/correction).

**Pipeline ordering**: in the `LLMStreamProcessor`, XML tool call extraction runs on raw content **before** the SAX scrub filter removes `<toolCall>`/`<think>` tags. This ensures the processor has a chance to parse and execute the tool call before the tag is stripped from visible output. When `knownTools` is not set, `toolCall`/`tool_call` tags are scrubbed unconditionally.

### `ThinkingParser` tag configurability

Already supports custom tags via constructor. During extraction: expose a convenience factory `ThinkingParser.forModel(modelId: string)` that picks the right tag pair (`<think>`/`</think>` for most, `<|thinking|>` for some fine-tunes, etc.) from a built-in map. The map is extensible via `ProcessorOptions.thinkingTagMap` so callers can add their own model-to-tag mappings without waiting for a library release.

### `appendToBlockquote` utility

Port the `appendToBlockquote(text, atLineStart)` helper from provider.ts. This correctly prefixes streamed markdown text with `>` at line boundaries, handling chunk-boundary line breaks. Useful for any consumer that renders thinking content in a blockquote.

### `formatXmlLikeResponseForDisplay`

Port from formatting.ts. Converts `<note>text</note>` → `**Note**\ntext`. This is opinionated formatting — exported as a standalone utility, not applied automatically by the processor. Consumers opt in via `sanitizeNonStreamingModelOutput()` or by calling it directly.

### Structured JSON parsing (new)

LLMs frequently wrap valid JSON in markdown fences, conversational prose ("Here's the JSON:"), or produce multiple objects per response. The `parseJson()` utility (Section 5d) handles all these cases robustly:

- **Markdown fence stripping**: detect and unwrap `` ```json ``` `` blocks (from llm-output-parser)
- **Prose wrapping**: strip leading/trailing conversational text around JSON (from llm-output-parser, Reddit discussion)
- **Multi-object selection**: when multiple JSON objects are found, return the most comprehensive one by key count + depth (from llm-output-parser)
- **Incomplete JSON recovery**: optionally attempt to close unclosed brackets for truncated responses (from llm-output-parser, simmering.dev discussion of retry strategies)
- **Schema validation**: validate against JSON Schema without requiring Zod as a runtime dep (from Vercel AI SDK `Output.object()`, instructor)

### Format instruction generation (new)

`buildFormatInstructions()` (Section 5d) takes a JSON Schema and produces natural-language instructions for inclusion in prompts. This pattern draws on:

- **LangChain** `PydanticOutputParser.get_format_instructions()` — generates "The output should be formatted as a JSON instance that conforms to the JSON schema below..."
- **Deepchecks** article on output parsers — documents how format instructions reduce malformed output
- **instructor** — injects Pydantic schema descriptions into prompts

### Repair prompt builder (new)

`buildRepairPrompt()` (Section 5d) constructs a re-prompt from a failed parse attempt. The pattern draws on:

- **LangChain `OutputFixingParser`** — sends another LLM call with the failed output and error
- **LangChain `RetryParser`** — retries with adjusted prompt on failure
- **Deepchecks** article — documents the retry/fix pattern

Critically, `buildRepairPrompt()` makes zero network calls. It only constructs the prompt text. The caller decides whether and how to re-invoke the LLM. This keeps the library I/O-free.

### Streaming/event and composition refinements

The extraction adds several complementary ergonomics without introducing framework lock-in:

- Event-based consumption (`.on('text')`, `.on('thinking')`, `.on('tool_call')`) for callback-driven integrations.
- Message accumulation (`accumulatedMessage`) for consumers that need final assembled output.
- Discriminated `parts` for switch-style handling of text/thinking/tool_call output.
- Functional composition via `pipe()` for parser chaining (`parseJson` → validation).

These are additive layers over the same core async-generator-compatible stream processing path.

### `saxophone` dependency note

`saxophone` is kept as a runtime dependency. It is unmaintained (last publish 2020) but stable and battle-tested. A future plan item should evaluate vendoring a fork or writing a minimal replacement if upstream remains inactive.

### Validation engine contract (new)

To prevent ambiguous behavior in `validateJsonSchema`, the library will define an explicit validation contract:

- `validateJsonSchema` supports a documented subset out-of-the-box (object/array/string/number/integer/boolean/enum/required/additionalProperties/min|maxItems/min|maximum/pattern/format where feasible).
- For full JSON Schema support, consumers may pass a validator adapter (e.g., Ajv-backed) via processor/config options.
- Validation errors are normalized into deterministic `string[]` messages to keep API stable across validator implementations.

This keeps the base package lightweight while preventing silent schema drift.

---

## 7. How Opilot Consumes It Back

The Opilot extension becomes a consumer:

```typescript
// src/provider.ts — after
import { LLMStreamProcessor, createVSCodeCopilotAdapter } from 'llm-stream-parser';

const processor = new LLMStreamProcessor({
  parseThinkTags: shouldThink,
  scrubContextTags: true,
  knownTools: effectiveTools ? new Set(effectiveTools.map(t => t.function.name)) : undefined,
});

for await (const chunk of response) {
  const out = processor.process(chunk.message);
  // route out.thinking, out.content, out.toolCalls to progress.report(...)
}
const final = processor.flush();
```

formatting.ts, thinkingParser.ts, and toolUtils.ts become thin re-exports or are deleted entirely once the dependency is in place.

---

## 8. Repo Layout

**Separate repo** (`github.com/selfagency/llm-stream-parser`)
Simpler for external contributors, clean versioning. Downside: cross-repo sync during active Opilot development.

---

## 9. Testing Strategy

- Port and expand existing tests from thinkingParser.test.ts, formatting.test.ts, toolUtils.test.ts
- Add corpus tests: real model response snapshots (a directory of `{input, expected}` fixture files) for cogito, deepseek-r1, qwen3, llama3.2 — covering each known output format variant
- Adapter tests use mocked sink types (no VS Code import)
- Performance regression test from the existing benchmark in formatting.test.ts moves into the library's test suite
- Security tests: verify `PRIVACY_TAGS` are always scrubbed with default options; verify `overrideScrubTags` logs a warning when privacy tags are omitted
- Input size tests: verify `maxInputLength` truncation works correctly and fires `onWarning`
- Structured JSON tests: markdown fence unwrapping, prose stripping, multi-object selection, incomplete JSON recovery, schema validation success/failure cases
- Format instruction tests: verify generated instructions contain schema-relevant field names and types
- Repair prompt tests: verify constructed prompt includes failed output, error message, and schema
- Event-based streaming tests: verify `.on('text', cb)` / `.on('thinking', cb)` / `.on('tool_call', cb)` fire during `process()` and `flush()`
- Message accumulation tests: verify `accumulatedMessage` aggregates content, thinking, and tool calls across multiple `process()` calls
- Discriminated parts tests: verify `parts` array contains correctly typed `OutputPart` entries matching flat-field values
- Composable pipeline tests: verify `pipe()` chains parsers correctly, propagates errors

---

## 10. Publishing & Exports

- `npm publish --access public` under `llm-stream-parser`
- Changeset-based releases if staying in the monorepo
- API documentation generated via TypeDoc and published alongside the package

### Subpath exports

Consumers who only need a subset can import from subpaths to keep bundle size minimal:

```jsonc
// package.json exports map
{
  ".": "./dist/index.js",
  "./thinking": "./dist/thinking/index.js",
  "./xml-filter": "./dist/xml-filter/index.js",
  "./tool-calls": "./dist/tool-calls/index.js",
  "./context": "./dist/context/index.js",
  "./structured": "./dist/structured/index.js",
  "./markdown": "./dist/markdown/index.js",
  "./processor": "./dist/processor/index.js",
  "./adapters/vscode": "./dist/adapters/vscode.js",
  "./adapters/generic": "./dist/adapters/generic.js"
}
```

### API stability contract

- **`0.x`**: any breaking change allowed between minor versions. Consumers should pin exact versions.
- **`1.0`**: public types and function signatures are frozen. No removal or signature change to `process()`, `processComplete()`, `flush()`, `addContent()`, `createXmlStreamFilter()`, `extractXmlToolCalls()`, `processStream()`, `parseJson()`, `validateJsonSchema()`, `buildFormatInstructions()`, `buildRepairPrompt()`, `pipe()`, `on()`, `off()`, `accumulatedMessage`. New features are additive only (new optional fields, new exports). Deprecations require one minor release of deprecation warnings before removal in the next major.

---

## 11. Security & Privacy

- **Privacy-safe defaults**: `DEFAULT_SCRUB_TAGS` always includes `PRIVACY_TAGS`. Consumers cannot accidentally leak `user_info`, `userData`, `userMemory`, etc. without explicitly using `overrideScrubTags`.
- **`overrideScrubTags` warning**: when privacy tags are omitted from an override set, the processor fires `onWarning('Privacy-sensitive tags omitted from scrub set: ...')`.
- **Tool schema safety**: `buildXmlToolSystemPrompt()` documentation warns that tool schemas are injected verbatim into prompts and must not contain secrets or credentials.
- **Input size limits**: `maxInputLength` option (default: unlimited) allows consumers to cap per-chunk input size. Chunks exceeding the limit are truncated and an `onWarning` is fired. This mitigates regex backtracking risk in `extractXmlToolCalls` on adversarial input.
- **No network access**: the library makes zero network calls. All I/O is the caller's responsibility.

## 11.1 Threat Model & Hard Limits

### Threat model assumptions

- Untrusted LLM output may contain adversarial payloads (deeply nested JSON/XML, regex stress strings, malformed wrapper tags, oversized tool payloads).
- Prompt/tool schemas provided by callers may contain sensitive text or unexpectedly large descriptions.
- Streaming inputs may include partial, interleaved, or repeated tool-like fragments.

### Hard limits (default values in 0.x)

- `maxInputLength`: 256 KB per chunk (configurable).
- `maxJsonDepth`: 64 levels.
- `maxJsonKeys`: 10,000 keys total.
- `maxToolCallsPerMessage`: 64.
- `maxToolArgumentBytes`: 128 KB per tool call.
- `maxXmlNestingDepth`: 64.

Breaches return deterministic parse/validation failures and emit `onWarning` telemetry.

### Additional safeguards

- `enforcePrivacyTags` default `true`: prevents `overrideScrubTags` from removing `PRIVACY_TAGS` unless explicitly disabled.
- Tool schema sanitization guidance in docs: no secrets, bounded description lengths, reject control characters where practical.
- Fuzz testing corpus for JSON/XML/regex-adversarial payloads is required before `1.0`.

---

## 12. Known Limitations

- **Streaming XML tool call extraction is not supported.** `extractXmlToolCalls` operates on complete text (used in the non-streaming XML fallback path). In the streaming path, tool calls must arrive via the native `tool_calls` field on chunks. Buffering partial XML tool tags during streaming is a future enhancement.
- **`formatXmlLikeResponseForDisplay` is opinionated.** It converts arbitrary XML tags to markdown headings — useful for Opilot but may not match other consumers' formatting preferences. It is opt-in, not applied by default.
- **`saxophone` is unmaintained.** Tracked as a future plan item to vendor or replace.
- **No Zod runtime dependency.** Schema validation uses JSON Schema as the interchange format. Consumers who prefer Zod must convert via `zodToJsonSchema()` on their side. This is a deliberate choice to keep the library dependency-free — Zod is 14 KB min+gzip and changes its API frequently.
- **No constrained token sampling.** Libraries like `outlines` and `guidance` hook into the token generation process to guarantee valid output via CFGs. This library operates post-generation only — it parses output after the LLM has produced it. Constrained sampling requires endpoint integration that is out of scope.
- **`parseJson` incomplete repair is best-effort.** The `repairIncomplete` option attempts to close unclosed brackets/braces but does not handle all malformed JSON cases (e.g., missing commas, unquoted keys). For critical applications, use provider-native structured output (e.g., OpenAI Responses API `text.format` with `json_schema`, strict function tools, or Ollama `format: 'json'`) instead.
- **`buildRepairPrompt` makes no network calls.** It constructs a re-prompt but does not send it. The caller is responsible for re-invoking the LLM and deciding how many retries to allow.
- **Streaming XML tool-call extraction remains non-goal in 0.x.** Partial XML fragments in streaming text are treated as plain text unless a complete non-stream parse path is used.

---

## 13. Getting Started (Third-party Example)

```typescript
import { processStream } from 'llm-stream-parser/adapters/generic';

// ollamaStream is any AsyncIterable<{ message?: { content?, thinking?, tool_calls? }, done? }>
for await (const out of processStream(ollamaStream, { parseThinkTags: true })) {
  if (out.thinking) console.log('[thinking]', out.thinking);
  if (out.content) process.stdout.write(out.content);
  for (const call of out.toolCalls) {
    console.log('[tool call]', call.name, call.parameters);
  }
}
```

For non-streaming (single complete response):

```typescript
import { LLMStreamProcessor } from 'llm-stream-parser/processor';

const processor = new LLMStreamProcessor({ parseThinkTags: true });
const result = processor.processComplete({
  content: response.message.content,
  thinking: response.message.thinking,
  tool_calls: response.message.tool_calls,
});
console.log(result.content); // clean output, context tags stripped
```

---

## 14. Prior Art & Design Influences

Features in this plan are informed by the following sources. Each bullet documents key influences and rationale.

### Repositories

- **[Vercel AI SDK](https://github.com/vercel/ai)** (`ai@6.x`, 22.5k stars) — Provider-agnostic model layer. Influence: `Output.object()` pattern for schema-validated structured output; async generator as universal streaming primitive; `generateText()` / `streamText()` clean split.
- **[Anthropic SDK TypeScript](https://github.com/anthropics/anthropic-sdk-typescript)** (`@anthropic-ai/sdk`, 1.7k stars) — Event-based streaming helpers (`.on('text', ...)`), `finalMessage()` accumulation helpers, structured outputs via JSON Schema/Zod helpers, and schema-validated tool helpers.
- **[OpenAI Node SDK](https://github.com/openai/openai-node)** (`openai@6.x`, 10.7k stars) — Responses API streaming via SSE, function/tool call deltas, and structured output controls via Responses `text.format` / strict tool schemas.
- **[Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript)** — Agent-level orchestration patterns. Confirmed that pure prompt-based tool parsing (vs provider-native) remains necessary for Ollama.
- **[Microsoft Agent Framework](https://github.com/microsoft/agent-framework)** (7.8k stars) — Middleware pipeline pattern, OpenTelemetry observability. The `onWarning` callback in `ProcessorOptions` is a lightweight analog of their middleware/telemetry.
- **[llm-output-parser](https://github.com/KameniAlexNea/llm-output-parser)** (Python, 4 stars) — Robust JSON/XML extraction from prose. Influence: markdown fence stripping, multi-object selection (most comprehensive by depth), incomplete JSON recovery, XML-to-dict conversion conventions.
- **[langschema](https://github.com/SohamGovande/langschema)** (TypeScript, 8 stars) — One-line typed parsers (`bool()`, `list()`, `asZodType()`). Influence: high-level convenience parsers alongside low-level primitives. Our `parseJson()` + `pipe()` pattern applies this without coupling to Zod.

### Articles

- **["The best library for structured LLM output"](https://simmering.dev/blog/structured_output/)** (simmering.dev) — Comprehensive comparison of 10 Python libraries across prompting, function calling, and constrained sampling. Confirmed our design choice to operate post-generation (not constrained sampling). Validated the JSON Schema → format instructions → retry loop as the standard pattern.
- **["LLM Output Parsing"](https://deepchecks.com/glossary/llm-output-parsing/)** (Deepchecks) — Documents `OutputFixingParser` and `RetryParser` patterns. Informed our `buildRepairPrompt()` design (pure prompt construction, no network).
- **["Advanced LLM parsing is the key to advanced AI applications"](https://www.reddit.com/r/datascience/comments/1fw5k23/)** (Reddit r/datascience) — Community discussion confirming that JSON extraction from prose + retry-on-failure is a common practical fallback. Also highlights that provider-native schema-constrained outputs should be preferred when available.
- **["Using Output Parsers"](https://apxml.com/courses/prompt-engineering-llm-application-development/chapter-7-output-parsing-validation-reliability/using-output-parsers)** (ApXML) — Documents LangChain's `PydanticOutputParser`, `CommaSeparatedListOutputParser`, `DatetimeOutputParser`. Informed our decision to keep `parseJson` generic rather than building task-specific parsers.
- **[LangChain output parser concepts](https://docs.langchain.com/oss/python/langchain/overview)** — parser-oriented composability patterns (`parse()`, `get_format_instructions()`, `parse_with_prompt()` family). Informed our `pipe()` composition pattern and `buildFormatInstructions()` API.

---

## 15. Acceptance Criteria & Rollout

### Definition of done (feature completeness)

- All extracted modules compile and pass unit tests in isolation.
- Opilot integration path can toggle between legacy parser and new package with a feature flag.
- Non-streaming output sanitation parity is demonstrated with snapshot tests.
- Tool-call extraction behavior is deterministic across bare XML and JSON-wrapped forms.
- Structured parsing path has explicit pass/fail semantics and normalized errors.

### Security and reliability gates

- Fuzz suite passes for JSON/XML/regex adversarial cases.
- Hard limits are enforced and covered by tests.
- Privacy-tag enforcement is tested for both default and override modes.
- No network side effects introduced by parser package.

### Rollout and rollback

1. Ship package behind Opilot feature flag (`parser.extracted.enabled=false` default).
2. Run dual-path comparison in CI (legacy vs extracted) on snapshot corpus.
3. Enable flag for internal builds only; collect parse failure metrics.
4. Flip default after parity threshold is met.
5. Keep rollback path for one minor release: if regressions occur, disable flag and fall back to legacy parser.

---

## Resolved Decisions

1. **SAX**: keep `saxophone`. Replacing it is ~200 lines of implementation for a ~15 KB saving — not worth it for the initial port. Track upstream status; vendor a fork if it remains unmaintained past 1.0.

2. **Tool call parameter types**: use `Record<string, unknown>` in the library's public contract.
   - `vscode.lm.invokeTool` already accepts `input: Record<string, unknown>`, so `string` coercion is a net downgrade.
   - JSON-wrapped calls naturally preserve typed values (`5` stays `5`); bare-XML values remain strings, which are valid `unknown`.
   - Callers can always narrow to string; they cannot recover a coerced number.
   - Opilot's existing usages are unaffected since `string` is assignable to `unknown`.

3. **Streaming primitive**: async generator as the universal core; adapters bridge per-runtime.
   - `processStream()` (generic adapter) is an async generator — works in extension host, Node.js, browsers, edge runtimes.
   - **VS Code adapter**: consumes the generator via callback/sink. Extension-host-safe, no Web Streams required.
   - Additional adapters (Vercel `ReadableStream`, Anthropic, LangChain) are candidates for later minor releases. Not shipped in 0.x to keep the maintenance surface small.

4. **Adapter scope for 0.x**: ship only the generic async generator adapter and the VS Code adapter. Additional adapters added in later minors based on demand.

5. **Schema validation uses JSON Schema, not Zod**: the library accepts `Record<string, unknown>` JSON Schema objects for validation with no Zod runtime dependency. JSON Schema remains the interchange format across OpenAI/Anthropic/LangChain ecosystems, while Zod users can convert via `zodToJsonSchema()`. This choice avoids coupling to Zod API churn and is influenced by Vercel AI SDK, instructor, and broader structured-output references cited in this plan.

6. **Structured output parsing is post-generation only**: the library does not implement constrained token sampling and instead parses text after generation. Constrained sampling requires endpoint-level integration most APIs do not expose. Provider-native structured output (`format: 'json'` in Ollama, Responses API `text.format` / strict function tools in OpenAI) is preferred when available; `parseJson()` is fallback normalization.

7. **`buildRepairPrompt` is I/O-free**: it constructs repair prompts but performs no network calls. The caller controls retry policy and re-invocation behavior. This is influenced by LangChain fixing/retry parser patterns while preserving the library's zero-network-access guarantee.

8. **Event-based streaming complements, rather than replaces, the async generator**: consumers can choose callback or iterator consumption models while receiving equivalent `ProcessedOutput` / `OutputPart` semantics. This is influenced by Anthropic SDK's dual consumption style.
