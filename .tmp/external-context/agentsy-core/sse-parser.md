---
source: GitHub source code (https://github.com/selfagency/agentsy)
library: Agentsy
package: @agentsy/core
topic: SSEParser & parseSSEStream
fetched: 2026-05-28T20:00:00Z
official_docs: https://github.com/selfagency/agentsy
---

# SSEParser & parseSSEStream (`@agentsy/core`)

## Import

```typescript
import { SSEParser, parseSSEStream } from '@agentsy/core/sse';
import type { SSEEvent, SSEParserOptions } from '@agentsy/core/sse';
```

---

## Class: SSEParser

A streaming SSE (Server-Sent Events) frame parser for LLM streaming responses. Handles cross-chunk frame splitting, BOM, multi-line data fields, and retry directives.

### Constructor

```typescript
class SSEParser {
  constructor(options?: SSEParserOptions);
}

interface SSEParserOptions {
  onError?: (error: Error) => void;   // Called on parsing errors (non-fatal)
  onEvent?: (event: SSEEvent) => void; // Called for each complete SSE event
}
```

### SSEEvent

```typescript
interface SSEEvent {
  data?: string;
  event?: string;
  id?: string;
  retry?: number;
}
```

### Methods

```typescript
// Feed a chunk of SSE text. May parse zero or more complete events.
write(chunk: string): void;

// Signal end of stream and flush remaining buffer.
end(): void;

// Reset parser state and buffer.
reset(): void;
```

### Usage (callback style)

```typescript
const parser = new SSEParser({
  onEvent: (event) => {
    if (event.data) {
      const parsed = JSON.parse(event.data);
      console.log('Got data:', parsed);
    }
  },
  onError: (err) => console.error('Parse error:', err),
});

parser.write('data: {"id": 1}\n\n');
parser.write('data: {"id": 2}\n\n');
parser.end();
```

---

## Function: parseSSEStream

Async generator that parses an SSE stream into SSEEvent objects.

```typescript
async function* parseSSEStream(
  source: ReadableStream<string> | AsyncIterable<string>
): AsyncGenerator<SSEEvent, void>
```

### Usage (async generator style)

```typescript
import { parseSSEStream } from '@agentsy/core/sse';

const response = await fetch(url);
for await (const event of parseSSEStream(response.body)) {
  if (event.data && event.data !== '[DONE]') {
    const parsed = JSON.parse(event.data);
    // process parsed data
  }
}
```

This is the function used internally by `createPipeline` in `@agentsy/providers`.
