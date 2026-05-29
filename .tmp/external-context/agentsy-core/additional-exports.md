---
source: GitHub source code (https://github.com/selfagency/agentsy)
library: Agentsy
package: @agentsy/core
topic: Additional exports (retry, formatting, structured, xml-filter)
fetched: 2026-05-28T20:00:00Z
official_docs: https://github.com/selfagency/agentsy
---

# Additional Pipeline-Related Exports (`@agentsy/core`)

---

## retry (`@agentsy/core`)

```typescript
import { retry } from '@agentsy/core';

function retry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions
): Promise<T>;

interface RetryOptions {
  backoffFactor?: number;   // Default: 2
  initialDelay?: number;    // Default: 1000
  maxAttempts?: number;     // Default: 3
  maxDelay?: number;        // Default: 30000
  signal?: AbortSignal;
}
```

Uses exponential backoff: `delay = min(initialDelay * backoffFactor^(attempt-1), maxDelay)`

---

## formatting (`@agentsy/core`)

```typescript
import {
  appendToBlockquote,
  formatXmlLikeResponseForDisplay,
  sanitizeNonStreamingModelOutput
} from '@agentsy/core';
```

### appendToBlockquote

Reformats text as a blockquote.

### formatXmlLikeResponseForDisplay

Formats XML-like responses for human-readable display.

### sanitizeNonStreamingModelOutput

Sanitizes non-streaming model output (removes control sequences, etc.).

---

## structured (`@agentsy/core`)

```typescript
import {
  parseJson,
  autoRepair,
  buildFormatInstructions,
  buildRepairPrompt,
  fieldValidator,
  streamJson,
  validateJsonSchema,
  zodAdapter
} from '@agentsy/core/structured';
```

### parseJson

```typescript
function parseJson(
  input: string,
  options?: {
    maxJsonDepth?: number;  // Default: 64
    maxJsonKeys?: number;   // Default: 10000
    repairIncomplete?: boolean;
  }
): unknown | null;
```

Used internally by `createPipeline` to parse SSE JSON data with nesting/key limits.

---

## xml-filter (`@agentsy/core`)

```typescript
import { createXmlStreamFilter, DEFAULT_SCRUB_TAGS, PRIVACY_TAGS } from '@agentsy/core';

// Used internally by LLMStreamProcessor when scrubContextTags: true
```

---

## createProcessorEventAdapter (`@agentsy/core/processor`)

```typescript
import { createProcessorEventAdapter } from '@agentsy/core/processor';

function createProcessorEventAdapter(
  processor: LLMStreamProcessor,
  options: ProcessorCallbackAdapterOptions
): { dispose(): void };

interface ProcessorCallbackAdapterOptions {
  onConversationEvent?: (event: ConversationEvent) => void;
  onFinish?: (finishReason?: FinishReason, usage?: UsageInfo) => void;
  onStep?: (stepIndex: number, usage?: UsageInfo) => void;
  onText?: (delta: string) => void;
  onThinking?: (delta: string) => void;
  onToolCall?: StreamEventMap['tool_call'];
  onToolCallDelta?: (delta: Extract<OutputPart, { type: 'tool_call_delta' }>) => void;
  onWarning?: (message: string, context?: Record<string, unknown>) => void;
}
```

---

## ProcessorStats (`@agentsy/core/processor`)

```typescript
interface ProcessorStats {
  averageChunkSize: number;
  bytesProcessed: number;
  chunksProcessed: number;
  contentDeltasCount: number;
  currentBufferSize: number;
  errorsCount: number;
  firstChunkAt?: Date;
  lastChunkAt?: Date;
  parseTimeMs: number;
  peakBufferSize: number;
  resetAt: Date;
  thinkingBlocksCount: number;
  toolCallsCount: number;
  warningsCount: number;
}
```

---

## @agentsy/providers exports (supplementary)

```typescript
// From @agentsy/providers:
export {
  // Adapters for direct provider usage
  // Normalizers for each provider
  normalizeAnthropicEvent, normalizeBedrockConverseEvent, normalizeCohereEvent,
  normalizeGeminiChunk, normalizeHuggingFaceTGIChunk, normalizeMistralChunk,
  normalizeOllamaChatChunk, normalizeOllamaGenerateChunk, normalizeOpenAIChatChunk,
  normalizeOpenAICompatibleChunk, normalizeOpenAIResponseEvent, normalizeZAiChunk,
  normalizeDeepSeekChunk,
  // Pipeline
  createPipeline,
  // Universal client
  // Capability bridge
} from '@agentsy/providers';
```
