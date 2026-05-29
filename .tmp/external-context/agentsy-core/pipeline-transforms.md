---
source: GitHub source code (https://github.com/selfagency/agentsy)
library: Agentsy
package: @agentsy/core
topic: Pipeline transforms (createSmoothStream, createThinkingFilter, createToolCallFilter)
fetched: 2026-05-28T20:00:00Z
official_docs: https://github.com/selfagency/agentsy
---

# Pipeline Transforms (`@agentsy/core`)

## Import

```typescript
import {
  createSmoothStream,
  createThinkingFilter,
  createToolCallFilter
} from '@agentsy/core';
// or
import {
  createSmoothStream,
  createThinkingFilter,
  createToolCallFilter,
  type PipelineTransform
} from '@agentsy/core/processor/pipeline';
```

## PipelineTransform type

```typescript
export type PipelineTransform = TransformStream<OutputPart, OutputPart>;
```

A standard `TransformStream` that accepts and emits `OutputPart` values. Use with `ReadableStream.pipeThrough()` or `LLMStreamProcessorOptions.transforms`.

---

## createSmoothStream

Breaks large text deltas into smaller sub-chunks. Non-text parts pass through unchanged.

```typescript
function createSmoothStream(options?: {
  chunkSize?: number;  // Max characters per emitted text chunk (default: 8)
  delayMs?: number;    // Delay in ms between emitted sub-chunks (default: 0)
}): PipelineTransform;
```

**Implementation:**

```typescript
export function createSmoothStream(options?: { chunkSize?: number; delayMs?: number }): PipelineTransform {
  const chunkSize = Math.max(1, options?.chunkSize ?? 8);
  const delayMs = Math.max(0, options?.delayMs ?? 0);

  return new TransformStream<OutputPart, OutputPart>({
    async transform(part, controller) {
      if (part.type !== 'text') {
        controller.enqueue(part);
        return;
      }
      const { text } = part;
      let offset = 0;
      while (offset < text.length) {
        if (delayMs > 0 && offset > 0) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
        controller.enqueue({
          text: text.slice(offset, offset + chunkSize),
          type: 'text'
        });
        offset += chunkSize;
      }
    }
  });
}
```

**Purpose:** Smooths out bursty LLM output so downstream renderers receive a steadier stream of tokens.

---

## createThinkingFilter

Strips `thinking` parts from the stream. All other parts pass through unchanged.

```typescript
function createThinkingFilter(): PipelineTransform;
```

**Implementation:**

```typescript
export function createThinkingFilter(): PipelineTransform {
  return new TransformStream<OutputPart, OutputPart>({
    transform(part, controller) {
      if (part.type !== 'thinking') {
        controller.enqueue(part);
      }
    }
  });
}
```

**Purpose:** Use when consumers never display chain-of-thought reasoning and want to avoid processing those parts.

---

## createToolCallFilter

Passes through only `tool_call` parts whose `name` matches one of the provided tool names. All non-`tool_call` parts (text, thinking, deltas) pass through unchanged.

```typescript
function createToolCallFilter(toolNames: string[]): PipelineTransform;
```

**Implementation:**

```typescript
export function createToolCallFilter(toolNames: string[]): PipelineTransform {
  const allowed = new Set(toolNames);
  return new TransformStream<OutputPart, OutputPart>({
    transform(part, controller) {
      if (part.type === 'tool_call' && !allowed.has(part.call.name)) {
        return;
      }
      controller.enqueue(part);
    }
  });
}
```

**Purpose:** Useful for consumers that only need to react to a subset of tool calls.

---

## Usage with LLMStreamProcessor

```typescript
import { LLMStreamProcessor } from '@agentsy/core/processor';
import { createSmoothStream, createThinkingFilter } from '@agentsy/core';

const processor = new LLMStreamProcessor({
  parseThinkTags: true,
  transforms: [
    createThinkingFilter(),                   // Strip thinking blocks
    createSmoothStream({ chunkSize: 4 }),     // Smooth text output
    createToolCallFilter(['get_weather'])     // Only keep get_weather calls
  ]
});

// partsStream is the piped output
const reader = processor.partsStream.getReader();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  // value: OutputPart — filtered and smoothed
}
```
