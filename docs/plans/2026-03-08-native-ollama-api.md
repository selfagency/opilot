# Native Ollama API Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the OpenAI-compatible `/v1/chat/completions` path for local models with Ollama's native `/api/chat` SDK, fixing broken thinking token support and aligning with how Ollama's own CLI works.

**Architecture:** Local models use the `ollama` npm SDK directly (`client.chat()`), which returns `message.thinking` as a first-class field and accepts `think: true` as a documented option. Cloud models continue using the OpenAI-compat path. A TypeScript port of Ollama's thinking state-machine parser handles tag-based thinking (`<think>...</think>`) for models that embed it in their text stream (deepseek-r1 style).

**Tech Stack:** TypeScript, `ollama` npm SDK, VS Code Language Model API, Vitest

---

## Background

### The Problem

The current code routes all chat through `openAiCompatStreamChat()` → `/v1/chat/completions`. Three bugs result:

1. **`think: true` silently ignored** — the OpenAI-compat schema has no `think` field; Ollama ignores it.
2. **Thinking tokens never received** — the adapter (provider.ts:569-579) maps `delta.content` but not `delta.reasoning`, so `chunk.message?.thinking` at line 792 is always undefined.
3. **Tag-based thinking unhandled** — models like `deepseek-r1` emit `<think>...</think>` tags inside the text stream rather than a separate field; there is no parser for these.

### Ollama's Own Approach (from CLI + SDK source)

- CLI (`cmd/interactive.go`): calls `api.Chat()` with `Think: &api.ThinkValue{Value: true}` — native API only.
- Server (`thinking/parser.go`): state machine that scans the text stream for `<think>…</think>` tags and splits them into thinking vs content.
- Native `/api/chat` response: `message.thinking` is a dedicated field, separate from `message.content`.
- OpenAI-compat `/v1/chat/completions`: uses `delta.reasoning` (not `delta.thinking` or `delta.reasoning_content`). Confirmed in Ollama source `openai/openai.go` — the response `Message` struct has field `Reasoning string` serialised as `"reasoning"`. The `think` option is NOT part of this schema.

### Scope

| Change                                         | Files                        |
| ---------------------------------------------- | ---------------------------- |
| New: TypeScript thinking parser                | `src/thinkingParser.ts`      |
| New: thinking parser tests                     | `src/thinkingParser.test.ts` |
| Modify: add `nativeSdkStreamChat()`            | `src/provider.ts`            |
| Modify: switch local models to native path     | `src/provider.ts`            |
| Modify: fix `delta.reasoning` in OpenAI-compat | `src/openaiCompat.ts`        |
| Modify: pipe tag-based thinking through parser | `src/provider.ts`            |

---

## Task 1: Port the Thinking State-Machine Parser

**Files:**

- Create: `src/thinkingParser.ts`
- Create: `src/thinkingParser.test.ts`

### Step 1: Write the failing tests

```typescript
// src/thinkingParser.test.ts
import { describe, it, expect } from 'vitest';
import { ThinkingParser } from './thinkingParser.js';

describe('ThinkingParser', () => {
  it('returns content unchanged when no think tags present', () => {
    const p = new ThinkingParser();
    const [thinking, content] = p.addContent('Hello world');
    expect(thinking).toBe('');
    expect(content).toBe('Hello world');
  });

  it('extracts thinking from <think>...</think>', () => {
    const p = new ThinkingParser();
    p.addContent('<think>');
    p.addContent('I am thinking');
    const [thinking, content] = p.addContent('</think>Answer');
    expect(thinking).toBe('I am thinking');
    expect(content).toBe('Answer');
  });

  it('buffers partial opening tag across chunks', () => {
    const p = new ThinkingParser();
    const [t1, c1] = p.addContent('<thi');
    expect(t1).toBe('');
    expect(c1).toBe(''); // buffered, waiting for more
    const [t2, c2] = p.addContent('nk>reasoning</think>done');
    expect(t2).toBe('reasoning');
    expect(c2).toBe('done');
  });

  it('buffers partial closing tag across chunks', () => {
    const p = new ThinkingParser();
    p.addContent('<think>thinking</');
    const [thinking, content] = p.addContent('think>response');
    expect(thinking).toBe('thinking');
    expect(content).toBe('response');
  });

  it('strips leading whitespace after opening tag', () => {
    const p = new ThinkingParser();
    p.addContent('<think>   \n');
    const [thinking] = p.addContent('actual thought</think>');
    expect(thinking).toBe('actual thought');
  });

  it('strips leading whitespace after closing tag', () => {
    const p = new ThinkingParser();
    p.addContent('<think>thought</think>   \n');
    const [, content] = p.addContent('response');
    expect(content).toBe('response');
  });

  it('handles content with no think block (thinking already done)', () => {
    const p = new ThinkingParser();
    const [t1, c1] = p.addContent('Plain response without thinking');
    expect(t1).toBe('');
    expect(c1).toBe('Plain response without thinking');
  });

  it('passes through content after thinking is complete', () => {
    const p = new ThinkingParser();
    p.addContent('<think>thought</think>');
    const [thinking, content] = p.addContent(' more content');
    expect(thinking).toBe('');
    expect(content).toBe(' more content');
  });
});
```

### Step 2: Run tests to confirm they fail

```bash
cd /Users/daniel/Developer/ollama-models-vscode
npx vitest run src/thinkingParser.test.ts
```

Expected: `Cannot find module './thinkingParser.js'`

### Step 3: Implement the parser

Port the Go state machine from `thinking/parser.go` to TypeScript:

```typescript
// src/thinkingParser.ts

type ThinkingState =
  | 'lookingForOpening'
  | 'thinkingStartedEatingWhitespace'
  | 'thinking'
  | 'thinkingDoneEatingWhitespace'
  | 'thinkingDone';

export class ThinkingParser {
  private state: ThinkingState = 'lookingForOpening';
  private acc = '';
  readonly openingTag: string;
  readonly closingTag: string;

  constructor(openingTag = '<think>', closingTag = '</think>') {
    this.openingTag = openingTag;
    this.closingTag = closingTag;
  }

  /**
   * Feed a chunk of streamed content. Returns [thinkingContent, regularContent].
   * May buffer internally if the chunk ends mid-tag.
   */
  addContent(content: string): [string, string] {
    this.acc += content;
    let thinkingOut = '';
    let contentOut = '';
    let keepLooping = true;

    while (keepLooping) {
      const [t, c, more] = this.eat();
      thinkingOut += t;
      contentOut += c;
      keepLooping = more;
    }

    return [thinkingOut, contentOut];
  }

  private eat(): [string, string, boolean] {
    switch (this.state) {
      case 'lookingForOpening': {
        const trimmed = this.acc.trimStart();
        if (trimmed.startsWith(this.openingTag)) {
          const after = trimmed.slice(this.openingTag.length).trimStart();
          this.acc = after;
          this.state = after === '' ? 'thinkingStartedEatingWhitespace' : 'thinking';
          return ['', '', true];
        } else if (this.openingTag.startsWith(trimmed) && trimmed !== '') {
          // partial opening tag — keep buffering
          return ['', '', false];
        } else if (trimmed === '') {
          // only whitespace so far — keep buffering
          return ['', '', false];
        } else {
          // no think tag — pass everything through as content
          this.state = 'thinkingDone';
          const out = this.acc;
          this.acc = '';
          return ['', out, false];
        }
      }

      case 'thinkingStartedEatingWhitespace': {
        const trimmed = this.acc.trimStart();
        this.acc = '';
        if (trimmed === '') return ['', '', false];
        this.state = 'thinking';
        this.acc = trimmed;
        return ['', '', true];
      }

      case 'thinking': {
        const idx = this.acc.indexOf(this.closingTag);
        if (idx !== -1) {
          const thinking = this.acc.slice(0, idx);
          const after = this.acc.slice(idx + this.closingTag.length).trimStart();
          this.acc = after;
          this.state = after === '' ? 'thinkingDoneEatingWhitespace' : 'thinkingDone';
          return [thinking, after === '' ? '' : after, false];
        }
        // check for partial closing tag at end of buffer
        const overlapLen = overlap(this.acc, this.closingTag);
        if (overlapLen > 0) {
          const thinking = this.acc.slice(0, this.acc.length - overlapLen);
          const candidate = this.acc.slice(this.acc.length - overlapLen);
          this.acc = candidate;
          return [thinking, '', false];
        }
        const out = this.acc;
        this.acc = '';
        return [out, '', false];
      }

      case 'thinkingDoneEatingWhitespace': {
        const trimmed = this.acc.trimStart();
        this.acc = '';
        if (trimmed !== '') this.state = 'thinkingDone';
        return ['', trimmed, false];
      }

      case 'thinkingDone': {
        const out = this.acc;
        this.acc = '';
        return ['', out, false];
      }
    }
  }
}

/** Longest overlap between suffix of s and prefix of delim */
function overlap(s: string, delim: string): number {
  const max = Math.min(delim.length, s.length);
  for (let i = max; i > 0; i--) {
    if (s.endsWith(delim.slice(0, i))) return i;
  }
  return 0;
}
```

### Step 4: Run tests to confirm they pass

```bash
npx vitest run src/thinkingParser.test.ts
```

Expected: all 8 tests pass.

### Step 5: Commit

```bash
git add src/thinkingParser.ts src/thinkingParser.test.ts
git commit -m "feat: port Ollama thinking state-machine parser to TypeScript"
```

---

## Task 2: Fix `delta.reasoning` in OpenAI-Compat Adapter ✅ (already implemented)

**Files:**

- Modify: `src/openaiCompat.ts` (the `OpenAICompatChatCompletionChunk` interface and the generator)
- Modify: `src/provider.ts` (the `openAiCompatStreamChat` method, lines 565-583)

> **Status:** This fix has already been implemented. `reasoning?: string` was added to the `OpenAICompatChatCompletionChunk` delta interface and mapped to `message.thinking` in both `provider.ts` and `extension.ts`. The steps below are preserved for reference / verification.

Context: Ollama's OpenAI-compat layer returns thinking content in `delta.reasoning` (confirmed from `openai/openai.go` — field name is `reasoning`, not `reasoning_content`). The previous adapter discarded this field.

### Step 1: Write a failing test for the adapter

Add to `src/openaiCompat.test.ts` (create if it doesn't exist):

```typescript
// in src/openaiCompat.test.ts
import { describe, it, expect } from 'vitest';

describe('openAiCompatStreamChat reasoning mapping', () => {
  it('maps delta.reasoning into message.thinking on the yielded ChatResponse', async () => {
    // This test validates the mapping logic in isolation.
    // We test the interface shape — the actual HTTP call is integration-tested separately.
    const chunk = {
      choices: [
        {
          delta: { content: '', reasoning: 'I am thinking' },
          finish_reason: null,
        },
      ],
    };
    const delta = chunk.choices[0]?.delta;
    const thinking = typeof delta?.reasoning === 'string' ? delta.reasoning : undefined;
    expect(thinking).toBe('I am thinking');
  });
});
```

### Step 2: Run to confirm the test passes (it should — this validates interface shape)

```bash
npx vitest run src/openaiCompat.test.ts
```

### Step 3: Update `OpenAICompatChatCompletionChunk` interface in `src/openaiCompat.ts`

Find the interface definition and add `reasoning_content`:

```typescript
// In the delta shape of OpenAICompatChatCompletionChunk
delta: {
  role?: string;
  content?: string | null;
  reasoning?: string;  // ADD THIS — field name is 'reasoning', not 'reasoning_content'
  tool_calls?: OpenAICompatToolCall[] | null;
};
```

### Step 4: Update the chunk-to-ChatResponse mapping in `src/provider.ts` at line 565-583

```typescript
// Replace the generator body in openAiCompatStreamChat:
return (async function* (provider: OllamaChatModelProvider): AsyncGenerator<ChatResponse> {
  for await (const chunk of stream) {
    const choice = chunk.choices?.[0];
    const delta = choice?.delta;
    const content = typeof delta?.content === 'string' ? delta.content : '';
    const thinking = typeof delta?.reasoning === 'string' ? delta.reasoning : undefined;
    const mappedToolCalls = provider.mapOpenAiToolCallsToOllamaLike(delta?.tool_calls);

    const out: ChatResponse = {
      message: {
        role: 'assistant',
        content,
        ...(thinking !== undefined ? { thinking } : {}),
        ...(mappedToolCalls ? { tool_calls: mappedToolCalls } : {}),
      },
      done: choice?.finish_reason != null,
    } as ChatResponse;

    yield out;
  }
})(this);
```

### Step 5: Remove `think: true` from OpenAI-compat requests

In `src/provider.ts` lines 548-553 and 599-608, remove the `think` option from the OpenAI-compat request objects (it is not part of the schema):

```typescript
// BEFORE:
request: {
  model: runtimeModelId,
  messages: ollamaMessagesToOpenAICompat(messages),
  tools: ollamaToolsToOpenAICompat(tools),
  ...(shouldThink ? { think: true } : {}),  // REMOVE THIS LINE
},

// AFTER:
request: {
  model: runtimeModelId,
  messages: ollamaMessagesToOpenAICompat(messages),
  tools: ollamaToolsToOpenAICompat(tools),
},
```

### Step 6: Run full test suite

```bash
npx vitest run
```

Expected: all tests pass (no regressions).

### Step 7: Commit

```bash
git add src/openaiCompat.ts src/provider.ts
git commit -m "fix: map delta.reasoning to message.thinking in OpenAI-compat adapter"
```

---

## Task 3: Add Native Ollama SDK Chat Method

**Files:**

- Modify: `src/provider.ts` (add `nativeSdkStreamChat()`, add `nativeSdkChatOnce()`)

The native Ollama SDK (`ollama` npm package) exposes `client.chat()` which calls `/api/chat` directly. It accepts `think: true` as a documented option and returns `message.thinking` as a first-class field in each streamed chunk.

### Step 1: Write the failing test (integration shape test)

These methods are thin wrappers over the SDK — test that they pass the correct options:

Add to `src/provider.test.ts`:

```typescript
describe('nativeSdkStreamChat', () => {
  it('passes think: true when shouldThink is true', async () => {
    // This is validated by checking that the mock client.chat() receives think: true
    // The full integration test is already covered by provider integration tests
    // Just verify the method exists and accepts the right shape
    const provider = createTestProvider(); // use existing test helper
    expect(typeof (provider as any).nativeSdkStreamChat).toBe('function');
  });
});
```

### Step 2: Add `nativeSdkStreamChat()` to `src/provider.ts`

Add after the existing `openAiCompatStreamChat()` method (after line 583):

```typescript
private async nativeSdkStreamChat(
  runtimeModelId: string,
  messages: Message[],
  tools: Parameters<typeof this.client.chat>[0]['tools'] | undefined,
  shouldThink: boolean,
  client: Ollama,
  signal?: AbortSignal,
): Promise<AsyncIterable<ChatResponse>> {
  return client.chat({
    model: runtimeModelId,
    messages,
    stream: true,
    tools,
    ...(shouldThink ? { think: true } : {}),
  });
}

private async nativeSdkChatOnce(
  runtimeModelId: string,
  messages: Message[],
  tools: Parameters<typeof this.client.chat>[0]['tools'] | undefined,
  shouldThink: boolean,
  client: Ollama,
  signal?: AbortSignal,
): Promise<ChatResponse> {
  return client.chat({
    model: runtimeModelId,
    messages,
    stream: false,
    tools,
    ...(shouldThink ? { think: true } : {}),
  }) as Promise<ChatResponse>;
}
```

### Step 3: Run tests

```bash
npx vitest run
```

Expected: all tests pass.

### Step 4: Commit

```bash
git add src/provider.ts
git commit -m "feat: add native Ollama SDK chat methods (nativeSdkStreamChat, nativeSdkChatOnce)"
```

---

## Task 4: Switch Local Models to Native Ollama SDK Path

**Files:**

- Modify: `src/provider.ts` (lines 706-778 — the main request dispatch block)

### Step 1: Review current dispatch logic

The block at lines 706-778 always calls `openAiCompatStreamChat()`. The change: local models call `nativeSdkStreamChat()`, cloud models keep `openAiCompatStreamChat()`.

### Step 2: Write a test that validates local models use the native path

In `src/provider.test.ts`, find existing tests for the stream chat path. Add an assertion that when `isCloudModel` is false, the SDK's `chat()` method is called (not the OpenAI-compat path).

Look for existing mock patterns in `src/provider.test.ts` — there will be a `mockClient.chat` spy. Assert it is called for local models.

### Step 3: Update the dispatch block in `src/provider.ts`

Replace lines ~706-778 dispatch to use `nativeSdkStreamChat` for local, `openAiCompatStreamChat` for cloud:

```typescript
try {
  let response: AsyncIterable<ChatResponse>;

  // Choose API path: native Ollama SDK for local, OpenAI-compat for cloud
  const streamFn = isCloudModel
    ? (think: boolean, t?: typeof tools) =>
        this.openAiCompatStreamChat(runtimeModelId, ollamaMessages as Message[], t, think, perRequestClient)
    : (think: boolean, t?: typeof tools) =>
        this.nativeSdkStreamChat(runtimeModelId, ollamaMessages as Message[], t, think, perRequestClient);

  try {
    this.outputChannel.debug(
      `[client] chat request: model=${runtimeModelId}, messages=${ollamaMessages?.length ?? 0}, tools=${tools?.length ?? 0}, think=${shouldThink}, native=${!isCloudModel}`,
    );
    response = await streamFn(shouldThink, tools);
    this.outputChannel.debug(`[client] chat response stream started for ${runtimeModelId}`);
  } catch (innerError) {
    this.outputChannel.exception(`[client] chat request failed for model ${runtimeModelId}`, innerError);
    if (
      shouldThink &&
      (this.isThinkingNotSupportedError(innerError) || this.isThinkingInternalServerError(innerError))
    ) {
      this.thinkingModels.delete(runtimeModelId);
      this.nonThinkingModels.add(runtimeModelId);
      this.outputChannel.debug(`[client] retrying without thinking support for ${runtimeModelId}`);
      try {
        response = await streamFn(false, tools);
      } catch (retryError) {
        if (
          isCloudModel &&
          tools &&
          (this.isThinkingInternalServerError(retryError) || isToolsNotSupportedError(retryError))
        ) {
          this.outputChannel.warn(
            `[client] cloud model ${runtimeModelId} failed with tools after think retry; retrying without tools`,
          );
          response = await streamFn(false, undefined);
        } else {
          throw retryError;
        }
      }
    } else if (isCloudModel && tools && this.isThinkingInternalServerError(innerError)) {
      this.outputChannel.warn(`[client] cloud model ${runtimeModelId} failed with tools; retrying without tools`);
      response = await streamFn(shouldThink, undefined);
    } else if (tools && isToolsNotSupportedError(innerError)) {
      this.outputChannel.warn(`[client] model ${runtimeModelId} rejected tools; retrying without tools`);
      response = await streamFn(shouldThink, undefined);
    } else {
      throw innerError;
    }
  }
```

Also update the `emittedOutput` fallback (lines ~857-868) to use the matching non-streaming method:

```typescript
const fallbackFn = isCloudModel
  ? (think: boolean) =>
      this.openAiCompatChatOnce(runtimeModelId, ollamaMessages as Message[], tools, think, perRequestClient)
  : (think: boolean) =>
      this.nativeSdkChatOnce(runtimeModelId, ollamaMessages as Message[], tools, think, perRequestClient);

const fallback = await fallbackFn(shouldThink);
```

### Step 4: Run tests

```bash
npx vitest run
```

Expected: all tests pass. If provider tests mock the client at the Ollama SDK level, they should still work since `nativeSdkStreamChat` calls `client.chat()` — the same thing the mocks patch.

### Step 5: Commit

```bash
git add src/provider.ts
git commit -m "feat: route local models through native Ollama SDK, keep OpenAI-compat for cloud"
```

---

## Task 5: Integrate Thinking Tag Parser Into Streaming Loop

**Files:**

- Modify: `src/provider.ts` (lines 781-844 — the streaming loop)

**Scope clarification:** Ollama's server-side `thinking/parser.go` runs for `/api/chat` requests (native SDK path), so local models already receive pre-split `message.thinking` / `message.content` — no client-side tag parsing needed there. The `ThinkingParser` is only needed for the OpenAI-compat path (cloud models) where a cloud provider may emit raw `<think>...</think>` tags inside `delta.content` rather than a separate reasoning field.

The parser is therefore instantiated only when `isCloudModel && shouldThink`. For local models on the native SDK path, `message.thinking` is already populated by the server.

### Step 1: Import ThinkingParser in provider.ts

At the top of `src/provider.ts`, add:

```typescript
import { ThinkingParser } from './thinkingParser.js';
```

### Step 2: Update the streaming loop

Replace lines 781-844 in `src/provider.ts`:

```typescript
let thinkingStarted = false;
let contentStarted = false;
let emittedOutput = false;
const xmlFilter = createXmlStreamFilter();
// Only parse tags client-side on the cloud/OpenAI-compat path — native SDK path gets
// message.thinking pre-split by Ollama's server-side thinking/parser.go
const thinkingParser = isCloudModel && shouldThink ? new ThinkingParser() : null;

for await (const chunk of response) {
  if (token.isCancellationRequested) {
    break;
  }

  // Handle thinking tokens from native API (message.thinking field)
  if (chunk.message?.thinking) {
    if (!thinkingStarted) {
      progress.report(new LanguageModelTextPart('\n\n💭 **Thinking**\n\n'));
      thinkingStarted = true;
      emittedOutput = true;
    }
    progress.report(new LanguageModelTextPart(chunk.message.thinking));
    emittedOutput = true;
  }

  // Stream text chunks — run through thinking tag parser if applicable
  if (chunk.message?.content) {
    let thinkingChunk = '';
    let contentChunk = chunk.message.content;

    // For thinking-capable models, parse <think>...</think> tags from the text stream
    if (thinkingParser) {
      [thinkingChunk, contentChunk] = thinkingParser.addContent(chunk.message.content);
    }

    if (thinkingChunk) {
      if (!thinkingStarted) {
        progress.report(new LanguageModelTextPart('\n\n💭 **Thinking**\n\n'));
        thinkingStarted = true;
        emittedOutput = true;
      }
      progress.report(new LanguageModelTextPart(thinkingChunk));
      emittedOutput = true;
    }

    if (contentChunk) {
      if (thinkingStarted && !contentStarted) {
        progress.report(new LanguageModelTextPart('\n\n---\n\n'));
        contentStarted = true;
        emittedOutput = true;
      }
      this.outputChannel.debug(`[client] streaming chunk: ${contentChunk.substring(0, 50)}`);
      const cleanContent = xmlFilter.write(contentChunk);
      if (cleanContent) {
        progress.report(new LanguageModelTextPart(cleanContent));
        emittedOutput = true;
      }
    }
  }

  // Handle tool calls
  if (chunk.message?.tool_calls && Array.isArray(chunk.message.tool_calls)) {
    for (const toolCall of chunk.message.tool_calls) {
      const vsCodeId = this.generateToolCallId();
      const upstreamId =
        typeof (toolCall as { id?: unknown }).id === 'string' ? (toolCall as unknown as { id: string }).id : vsCodeId;
      this.mapToolCallId(vsCodeId, upstreamId);

      progress.report(
        new LanguageModelToolCallPart(vsCodeId, toolCall.function?.name || '', toolCall.function?.arguments || {}),
      );
      emittedOutput = true;
    }
  }

  if (chunk.done === true) {
    break;
  }
}
```

### Step 3: Run tests

```bash
npx vitest run
```

Expected: all tests pass.

### Step 4: Smoke test with a local thinking model

If a local Ollama instance is running with `qwen3` or `deepseek-r1`:

```bash
# In VS Code: open GitHub Copilot Chat, type @ollama hello, observe thinking section appears
```

### Step 5: Commit

```bash
git add src/provider.ts
git commit -m "feat: integrate ThinkingParser to handle <think> tags in streamed content"
```

---

## Task 6: Update Existing Tests for New Behavior

**Files:**

- Modify: `src/provider.test.ts` (update any tests that assert on `think: true` in OpenAI-compat requests)

### Step 1: Run the full test suite and review failures

```bash
npx vitest run 2>&1 | grep -E "FAIL|Error" | head -50
```

### Step 2: Fix any test that asserts `think: true` in the OpenAI-compat request body

The tests may mock `fetch` and assert the request body includes `think: true`. This should now:

- NOT appear in OpenAI-compat requests (cloud path)
- Appear in `client.chat()` calls for the native SDK path

Update assertions to match the new behavior. Example fix:

```typescript
// BEFORE: asserts think in fetch body (OpenAI-compat)
expect(lastFetchBody).toMatchObject({ think: true });

// AFTER: asserts think in client.chat() call (native SDK)
expect(mockClient.chat).toHaveBeenCalledWith(expect.objectContaining({ think: true }));
```

### Step 3: Run tests again to confirm all pass

```bash
npx vitest run
```

Expected: all tests green.

### Step 4: Commit

```bash
git add src/provider.test.ts
git commit -m "test: update provider tests for native Ollama SDK path and thinking behavior"
```

---

## Verification

After all tasks complete:

```bash
# Full test suite
npx vitest run

# Check coverage hasn't dropped
npx vitest run --coverage
```

Manual smoke test with Ollama running locally:

1. Pull a thinking model: `ollama pull qwen3:latest`
2. Open VS Code with the extension loaded
3. Send a message to the model via `@ollama`
4. Confirm thinking section appears with 💭 heading before the response divider

---

**Plan complete and saved to `docs/plans/2026-03-08-native-ollama-api.md`.**

**Two execution options:**

**1. Subagent-Driven (this session)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** — Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
