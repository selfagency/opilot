---
source: GitHub source code (https://github.com/selfagency/agentsy)
library: Agentsy
package: @agentsy/core
topic: LLMStreamProcessor — core stream processing engine
fetched: 2026-05-28T20:00:00Z
official_docs: https://github.com/selfagency/agentsy
---

# LLMStreamProcessor (`@agentsy/core`)

## Import

```typescript
import { LLMStreamProcessor } from '@agentsy/core/processor';
// types:
import type {
  ProcessedOutput,
  ProcessorOptions,
  OutputPart,
  StreamEventMap,
  IncompletenessDetail,
  IncompletenessType
} from '@agentsy/core/processor';
```

## Class: LLMStreamProcessor

The core stream processing engine. Processes normalized LLM stream chunks chunk-by-chunk, extracting thinking blocks, filtering XML tags, accumulating tool calls, and emitting typed events.

### Constructor

```typescript
class LLMStreamProcessor {
  constructor(options?: ProcessorOptions);
}
```

### ProcessorOptions

```typescript
interface ProcessorOptions {
  accumulateNativeToolCalls?: boolean;   // Default: true
  enforcePrivacyTags?: boolean;
  extraScrubTags?: Set<string>;
  knownTools?: Set<string>;
  maxInputLength?: number;              // Default: 262144 (256 KiB), 0 = disable
  maxResidualBytes?: number;            // Default: 1048576 (1 MiB), 0 = disable
  maxToolArgumentBytes?: number;        // Default: 131072 (128 KiB), 0 = disable
  maxToolCallsPerMessage?: number;      // Default: 64, 0 = disable
  maxWarnings?: number;                 // Default: 100, 0 = disable
  maxXmlNestingDepth?: number;          // Default: 64, 0 = disable
  modelId?: string;
  onWarning?: (message: string, context?: Record<string, unknown>) => void;
  overrideScrubTags?: Set<string>;
  parseThinkTags?: boolean;             // Default: true
  scrubContextTags?: boolean;           // Default: true
  thinkingCloseTag?: string;
  thinkingOpenTag?: string;
  thinkingTagMap?: Map<string, ThinkingTagPair>;
  toolCallParsers?: ToolCallParser[];
  transforms?: TransformStream<OutputPart, OutputPart>[];  // Pipeline transforms
}
```

### OutputPart (discriminated union)

```typescript
type OutputPart =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_call'; call: XmlToolCall; state: ToolCallState }
  | {
      type: 'tool_call_delta';
      id?: string;
      name: string;
      argumentsDelta: string;
      index: number;
    };
```

### ProcessedOutput

```typescript
interface ProcessedOutput {
  content: string;
  done: boolean;
  finishReason?: FinishReason;
  incomplete: boolean;
  incompleteness: IncompletenessDetail[];
  parts: OutputPart[];
  stepIndex?: number;
  stepUsage?: UsageInfo;
  thinking: string;
  toolCalls: XmlToolCall[];
  usage?: UsageInfo;
}
```

### Methods

```typescript
// Process a single stream chunk. Returns processed output delta.
process(chunk: StreamChunk): ProcessedOutput

// Process a complete non-streaming response (process + flush combined).
processComplete(response: StreamChunk): ProcessedOutput

// Flush buffered state. Always call after last chunk.
flush(): ProcessedOutput

// Reset processor for reuse across conversations.
reset(): void

// Event subscription
on<K extends keyof StreamEventMap>(event: K, listener: StreamEventMap[K]): this
off<K extends keyof StreamEventMap>(event: K, listener: StreamEventMap[K]): this
```

### Events (StreamEventMap)

```typescript
interface StreamEventMap {
  conversation_event: (event: ConversationEvent) => void;
  done: () => void;
  text: (delta: string) => void;
  thinking: (delta: string) => void;
  tool_call: (call: XmlToolCall) => void;
  tool_call_delta: (delta: Extract<OutputPart, { type: 'tool_call_delta' }>) => void;
  tool_call_part: (part: Extract<OutputPart, { type: 'tool_call' }>) => void;
  usage: (usage: UsageInfo) => void;
  warning: (message: string, context?: Record<string, unknown>) => void;
}
```

### Properties

```typescript
// A ReadableStream<OutputPart> that emits every part from process() and flush().
// If transforms were supplied, this is the piped result.
get partsStream(): ReadableStream<OutputPart>

// Accumulated thinking text
get accumulatedThinking(): string

// Complete accumulated message snapshot
get accumulatedMessage(): AccumulatedMessage

// Processing statistics
getStats(): ProcessorStats
```

### AccumulatedMessage

```typescript
interface AccumulatedMessage {
  content: string;
  thinking: string;
  toolCalls: XmlToolCall[];
  usage?: UsageInfo;
}
```

### Usage

```typescript
const processor = new LLMStreamProcessor({
  parseThinkTags: true,
  knownTools: new Set(['get_weather', 'search']),
  modelId: 'llama3.2',
});

for await (const chunk of normalizedStream) {
  const output = processor.process(chunk);
  if (output.content) process.stdout.write(output.content);
  if (output.thinking) console.log('\n[thinking]:', output.thinking);
}

const final = processor.flush();
if (final.incomplete) {
  console.warn('Stream cut short:', final.incompleteness);
}

// Event-driven usage
processor.on('text', delta => process.stdout.write(delta));
processor.on('tool_call', call => console.log('Tool called:', call.name));
processor.on('tool_call_delta', delta => 
  console.log('Args delta:', delta.argumentsDelta)
);
processor.on('done', () => console.log('Done'));
processor.on('warning', (msg, ctx) => console.warn('Warning:', msg, ctx));
```
