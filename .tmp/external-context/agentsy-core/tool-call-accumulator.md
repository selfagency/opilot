---
source: GitHub source code (https://github.com/selfagency/agentsy)
library: Agentsy
package: @agentsy/core
topic: ToolCallAccumulator & related tool-call exports
fetched: 2026-05-28T20:00:00Z
official_docs: https://github.com/selfagency/agentsy
---

# Tool-Call APIs (`@agentsy/core`)

## Import

```typescript
import { ToolCallAccumulator } from '@agentsy/core';
// or
import { ToolCallAccumulator } from '@agentsy/core/tool-calls';

// Other tool-call exports:
import {
  buildNativeToolsPayload,
  buildToolResultMessage,
  buildXmlToolSystemPrompt,
  extractXmlToolCalls,
} from '@agentsy/core/tool-calls';
```

---

## ToolCallAccumulator

Accumulates incremental native tool call argument deltas from streaming LLM providers (e.g., OpenAI `tool_calls[].function.arguments` deltas, Anthropic `input_json_delta`). Multiple tool calls distinguished by numeric `index`.

```typescript
class ToolCallAccumulator {
  // Accumulate a streaming delta
  addDelta(delta: NativeToolCallDelta): void;

  // Get calls whose argument buffer is currently valid JSON (mid-stream)
  getCompletedCalls(): NativeToolCall[];
  getCompletedCallsWithIndices(): { index: number; call: NativeToolCall }[];

  // Remove a call by index (after mid-stream emission)
  removeCall(index: number): void;

  // Get pending call info (name, id) for a given index
  getPendingCallInfo(index: number): { name?: string; id?: string } | undefined;

  // Get lifecycle state for a pending call
  getPendingToolCallState(index: number): ToolCallState | undefined;

  // Force-complete all pending calls with JSON repair
  flush(): NativeToolCall[];
  flushWithIndices(): { index: number; call: NativeToolCall }[];

  // Clear all accumulated state
  reset(): void;
}
```

### NativeToolCall

```typescript
interface NativeToolCall {
  arguments: JsonObject;
  id?: string;   // Provider-assigned call ID
  name: string;
}
```

### NativeToolCallDelta

```typescript
// From @agentsy/types:
interface NativeToolCallDelta {
  index: number;
  id?: string;
  name?: string;
  argumentsDelta?: string;
}
```

### Usage

```typescript
const accumulator = new ToolCallAccumulator();

for await (const chunk of stream) {
  for (const delta of chunk.nativeToolCallDeltas) {
    accumulator.addDelta(delta);

    // Check mid-stream for completed calls
    for (const { call, index } of accumulator.getCompletedCallsWithIndices()) {
      console.log('Tool call complete:', call.name, call.arguments);
      accumulator.removeCall(index); // Prevent double-emission at flush
    }
  }
}

// At stream end, flush any remaining incomplete calls
const remaining = accumulator.flush();
```

---

## Other tool-call exports

### extractXmlToolCalls

```typescript
function extractXmlToolCalls(text: string, knownTools: Set<string>): XmlToolCall[];
```

### buildXmlToolSystemPrompt

```typescript
function buildXmlToolSystemPrompt(knownTools: Set<string>): string;
```

### buildNativeToolsPayload

```typescript
function buildNativeToolsPayload(tools: ToolDefinition[]): any;
```

### buildToolResultMessage

```typescript
function buildToolResultMessage(toolCallId: string, result: unknown): any;
```
