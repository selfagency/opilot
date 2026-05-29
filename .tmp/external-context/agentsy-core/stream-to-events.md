---
source: GitHub source code (https://github.com/selfagency/agentsy)
library: Agentsy
package: @agentsy/core
topic: streamToEvents & createStreamEventAdapter
fetched: 2026-05-28T20:00:00Z
official_docs: https://github.com/selfagency/agentsy
---

# Stream-to-Events Adapter (`@agentsy/core`)

## Import

```typescript
import { streamToEvents, createStreamEventAdapter } from '@agentsy/core';
import type { StreamRuntimeEvent, StreamEventAdapterOptions } from '@agentsy/core';
```

---

## streamToEvents (AsyncGenerator-based)

Reads a `ReadableStream<NormalizedChunk>` and yields typed `StreamRuntimeEvent` values.

```typescript
async function* streamToEvents(
  stream: ReadableStream<NormalizedChunk>
): AsyncGenerator<StreamRuntimeEvent>
```

### StreamRuntimeEvent

```typescript
type StreamRuntimeEvent =
  | { type: 'text-delta'; chunkIndex: number; timestamp: number; payload: { delta: string } }
  | { type: 'thinking-delta'; chunkIndex: number; timestamp: number; payload: { delta: string } }
  | { type: 'tool-call-start'; chunkIndex: number; timestamp: number; payload: { id: string; name: string; args: unknown } }
  | { type: 'tool-call-end'; chunkIndex: number; timestamp: number; payload: { id: string; result?: unknown } }
  | { type: 'error'; chunkIndex: number; timestamp: number; payload: { message: string; code?: string } }
  | { type: 'done'; chunkIndex: number; timestamp: number; payload: { finishReason?: string; usage?: { inputTokens: number; outputTokens: number; totalTokens: number } } }
```

### Usage

```typescript
const response = await client.stream(request);
for await (const event of streamToEvents(response)) {
  switch (event.type) {
    case 'text-delta':
      process.stdout.write(event.payload.delta);
      break;
    case 'thinking-delta':
      console.log('\nThinking:', event.payload.delta);
      break;
    case 'tool-call-start':
      console.log(`Tool call started: ${event.payload.name}(${event.payload.args})`);
      break;
    case 'tool-call-end':
      console.log(`Tool call ended: ${event.payload.id}`);
      break;
    case 'done':
      console.log('Stream complete', event.payload.finishReason);
      break;
    case 'error':
      console.error('Stream error:', event.payload.message);
      break;
  }
}
```

---

## createStreamEventAdapter (Callback-based)

Wraps `streamToEvents` in a callback-driven interface.

```typescript
function createStreamEventAdapter(options: StreamEventAdapterOptions): {
  start: (streamPromise: Promise<ReadableStream<NormalizedChunk>>) => Promise<void>;
  abort: () => void;
}

interface StreamEventAdapterOptions {
  onDone?: (finishReason?: string, usage?: any) => void;
  onError?: (error: Error) => void;
  onEvent?: (event: StreamRuntimeEvent) => void;   // Catch-all
  onText?: (delta: string) => void;
  onThinking?: (delta: string) => void;
  onToolCallEnd?: (id: string, result?: unknown) => void;
  onToolCallStart?: (id: string, name: string, args: unknown) => void;
}
```

### Usage

```typescript
const adapter = createStreamEventAdapter({
  onText: (d) => process.stdout.write(d),
  onThinking: (d) => console.log('\nThinking:', d),
  onDone: (reason) => console.log('Finished:', reason),
  onError: (err) => console.error('Error:', err),
});

await adapter.start(client.stream(request));
// Later, to cancel mid-flight:
adapter.abort();
```
