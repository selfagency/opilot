---
source: GitHub source code (https://github.com/selfagency/agentsy)
library: Agentsy
package: @agentsy/core
topic: captureStreamState & buildContinuationPrompt
fetched: 2026-05-28T20:00:00Z
official_docs: https://github.com/selfagency/agentsy
---

# Stream Recovery APIs (`@agentsy/core/recovery`)

## Import

```typescript
import { captureStreamState, buildContinuationPrompt } from '@agentsy/core/recovery';
// Types:
import type {
  ContinuationMessage,
  ContinuationOptions,
  StreamSnapshot
} from '@agentsy/core/recovery';
```

---

## captureStreamState

Captures the current accumulated state of an `LLMStreamProcessor` for later stream resumption or retry.

```typescript
function captureStreamState(
  processor: LLMStreamProcessor,
  options?: ProcessorOptions
): StreamSnapshot;
```

### StreamSnapshot

```typescript
interface StreamSnapshot {
  /** Accumulated assistant content at the time the snapshot was taken. */
  content: string;
  /** The ProcessorOptions the processor was constructed with (for rebuilding). */
  options: ProcessorOptions;
  /** Accumulated thinking/scratchpad content. */
  thinking: string;
  /** Unix timestamp (ms) when the snapshot was taken. */
  timestamp: number;
  /** Tool calls that were completed up to this point. */
  toolCalls: XmlToolCall[];
  /** Accumulated token usage, if available. */
  usage?: UsageInfo;
}
```

---

## buildContinuationPrompt

Builds provider-appropriate messages that allow resuming a stream that was interrupted mid-response.

```typescript
function buildContinuationPrompt(
  snapshot: StreamSnapshot,
  options?: ContinuationOptions
): ContinuationMessage[];
```

### ContinuationOptions

```typescript
interface ContinuationOptions {
  /**
   * The target provider. Controls how the continuation prompt is formatted.
   * - 'anthropic': Prepend the partial assistant turn as an assistant message.
   * - 'openai': Append the partial assistant message then add a user continuation message.
   * - 'ollama': Same format as OpenAI.
   * Default: 'openai'
   */
  provider?: 'openai' | 'anthropic' | 'ollama';
}
```

### ContinuationMessage

```typescript
interface ContinuationMessage {
  content: string;
  role: 'user' | 'assistant';
}
```

### Behavior by provider

| Provider | Continuation format |
|---|---|
| `anthropic` | Returns `[{ role: 'assistant', content: partialContent }]` (prepend partial turn) |
| `openai` (default) | Returns `[{ role: 'assistant', content: partialContent }, { role: 'user', content: 'Please continue...' }]` |
| `ollama` | Same as `openai` |

If partial content is empty, returns a single user message.  
Includes completed tool calls context if any exist.

### Full usage example

```typescript
import { LLMStreamProcessor } from '@agentsy/core/processor';
import { captureStreamState, buildContinuationPrompt } from '@agentsy/core/recovery';

const processor = new LLMStreamProcessor({ parseThinkTags: true });

try {
  for await (const chunk of stream) {
    processor.process(chunk);
  }
} catch (error) {
  // Stream was interrupted — capture state
  const snapshot = captureStreamState(processor);

  // Build continuation messages for Ollama
  const continuationMessages = buildContinuationPrompt(snapshot, {
    provider: 'ollama'
  });

  // Prepend to conversation history and retry
  const retryMessages = [
    ...previousMessages,
    ...continuationMessages
  ];

  // Retry with retryMessages...
}
```
