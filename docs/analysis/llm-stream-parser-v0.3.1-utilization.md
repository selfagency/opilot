# llm-stream-parser v0.3.1 Utilization Analysis

## Current Status: **30% Utilization**

We are using only the core parsing and formatting utilities. Major capabilities for agent coordination, state management, and VSCode integration are **completely unused**.

---

## ✅ Currently Used (Comprehensive List)

### 1. **Thinking Parsing** (`@selfagency/llm-stream-parser/thinking`)

- **Usage**: `src/thinkingParser.ts`, `src/provider.ts:955`
- **Capability**: `ThinkingParser.forModel(modelId)`
- **Purpose**: Extract `<think>` tags from model output (fallback for models that emit raw XML instead of structured thinking)
- **Status**: ✅ Fully utilized for model-specific thinking extraction

```typescript
const thinkingParser = shouldThink ? ThinkingParser.forModel(runtimeModelId) : null;
```

### 2. **Tool Call Extraction** (`@selfagency/llm-stream-parser/tool-calls`)

- **Usage**: `src/toolUtils.ts`, `src/provider.ts`
- **Capabilities Used**:
  - `buildNativeToolsArray()` - Convert VS Code language model tools to Ollama format
  - `extractXmlToolCalls()` - Parse XML tool calls from model output
  - `buildXmlToolSystemPrompt()` - Generate system prompts for XML tool calling
- **Status**: ✅ Fully utilized for native tool coordination

### 3. **XML Context Blocks** (`@selfagency/llm-stream-parser/context`)

- **Usage**: `src/formatting.ts`, `src/provider.ts`
- **Capabilities Used**:
  - `splitLeadingXmlContextBlocks()` - Parse `<context>` blocks from model
  - `dedupeXmlContextBlocksByTag()` - Remove duplicate context blocks
  - `stripXmlContextTags()` - Clean up context XML from final output
- **Status**: ✅ Fully utilized for context management

### 4. **XML Streaming Filter** (`@selfagency/llm-stream-parser/xml-filter`)

- **Usage**: `src/formatting.ts`, `src/provider.ts:967`
- **Capability**: `createXmlStreamFilter()` - Parse XML tags during streaming (graceful degradation if XML arrives across chunks)
- **Status**: ✅ Fully utilized for robust XML parsing

### 5. **Markdown Utilities** (`@selfagency/llm-stream-parser/markdown`)

- **Usage**: `src/provider.ts:1`
- **Capability**: `appendToBlockquote()` - Format text as blockquotes
- **Status**: ✅ Utilized for markdown formatting

---

## ❌ Available but Unused (High-Value Opportunities)

### 1. **Agent Loop** (`@selfagency/llm-stream-parser/agent`)

**Priority: 🔴 CRITICAL** | **Complexity**: Medium | **Impact**: High

**What it does**:

- Manages multi-step tool invocation and model looping
- Automatically handles tool calls, thinking, and step coordination
- Detects and prevents infinite loops (doom loop detection)
- Provides structured step results and state tracking

**Available Functions**:

```typescript
// Main API
createAgentLoop(options: AgentLoopOptions): AgentLoopHandle

// Stop conditions
isStepCount(maxSteps: number): StopCondition
hasNoToolCalls(): StopCondition
finishReasonIs(...reasons: FinishReason[]): StopCondition
detectDoomLoop(threshold?: number): StopCondition
```

**Key Types**:

```typescript
interface AgentLoopOptions {
  execute: (messages: unknown[]) => AsyncIterable<StreamChunk>;
  stopWhen: StopCondition | StopCondition[];
  onStep?: (result: StepResult) => void;
  onAgUiEvent?: (event: AgUiEvent) => void;
  runId?: string;
  threadId?: string;
  buildToolResultMessages: (toolCalls: XmlToolCall[]) => Promise<unknown[]>;
  maxSteps?: number;
  maxConversationMessages?: number;
}

interface AgentLoopState {
  steps: StepResult[];
  stepIndex: number;
  lastOutput: ProcessedOutput;
  toolCallCount: number;
  consecutiveIdenticalCalls: number;
}
```

**Current Implementation Gap**:

- `src/provider.ts:969+` implements manual streaming loop
- Does NOT coordinate tool calls across steps
- Does NOT track step count or consecutive identical calls
- Does NOT use AG-UI events for step visualization
- No automatic doom loop detection

**Integration Point**: `src/provider.ts`, `handleDirectOllamaRequest()`, `streamModelResponse()`

**Recommendation**: **Replace manual streaming loop with agent loop for Phase 8 (Tool Invocation)**

---

### 2. **VSCode Copilot Adapter** (`@selfagency/llm-stream-parser/adapters`)

**Priority: 🟡 HIGH** | **Complexity**: Low | **Impact**: Medium

**What it does**:

- Provides VSCode-specific event stream formatting
- Converts generic LLM streams to VSCode chat protocol
- Handles Copilot-specific event types (thinking visibility, tool calls, etc.)

**Available Functions**:

```typescript
export {
  VSCodeChatStream,
  VSCodeCopilotAdapterOptions,
  createVSCodeCopilotAdapter,
} from '@selfagency/llm-stream-parser/adapters';

interface VSCodeCopilotAdapterOptions {
  stream: AsyncIterable<StreamChunk>;
  thinkingStyle?: 'native' | 'markdown' | 'hidden';
  toolCallMode?: 'native' | 'xml' | 'inline';
  hideThinkingByDefault?: boolean;
}
```

**Current Implementation Gap**:

- Direct streaming to VSCode without adapter abstraction
- Manual event conversion in `src/provider.ts:1000+`
- No standardized event protocol

**Integration Point**: `src/provider.ts`, `streamModelResponse()`, loop over response chunks

**Recommendation**: **Evaluate as optimization opportunity for cleaner event handling**

---

### 3. **Event Pipelines & Transforms** (`@selfagency/llm-stream-parser/pipeline`)

**Priority: 🟡 HIGH** | **Complexity**: Low | **Impact**: Medium

**What it does**:

- Provides composable stream transformations
- Filters thinking content (can hide by default)
- Filters tool calls by name
- Smooths token output for better UX

**Available Functions**:

```typescript
createPipeline(source: AsyncIterable<string>, options: PipelineOptions):
  AsyncGenerator<PipelineEvent>

createSmoothStream(options?: {
  chunkSize?: number;
  delayMs?: number;
}): PipelineTransform

createThinkingFilter(): PipelineTransform
// Strips thinking parts from stream

createToolCallFilter(toolNames: string[]): PipelineTransform
// Filters tool calls by name
```

**Current Implementation Gap**:

- Thinking is manually hidden in `src/provider.ts:1015`
- No pipeline abstraction layer
- Manual loop for each transform

**Integration Point**: `src/provider.ts`, `streamModelResponse()` chunk processing

**Recommendation**: **Use as foundation for Phase 6 (Chat Customization) thinking visibility toggle**

---

### 4. **Stream State Capture & Recovery** (`@selfagency/llm-stream-parser/recovery`)

**Priority: 🟢 MEDIUM** | **Complexity**: Medium | **Impact**: Medium

**What it does**:

- Captures streaming state at any point (for cancellation resilience)
- Allows resuming interrupted streams with context continuation
- Provider-aware continuation prompt formatting (OpenAI, Anthropic, Ollama)

**Available Functions**:

```typescript
captureStreamState(processor: LLMStreamProcessor, options?: ProcessorOptions):
  StreamSnapshot

buildContinuationPrompt(snapshot: StreamSnapshot, options?: ContinuationOptions):
  ContinuationMessage[]

interface StreamSnapshot {
  content: string;
  thinking: string;
  toolCalls: XmlToolCall[];
  usage?: UsageInfo;
  options: ProcessorOptions;
  timestamp: number;
}
```

**Current Implementation Gap**:

- No cancellation recovery mechanism
- Cancelled requests lose all progress
- No state snapshot capability

**Integration Point**: `src/provider.ts`, `token.onCancellationRequested` handler

**Recommendation**: **Implement for Phase 11 (Advanced Features) to handle cancellation gracefully**

---

### 5. **Generic Adapter** (`@selfagency/llm-stream-parser/adapters/generic`)

**Priority**: 🟢 LOW | **Complexity**: Low | **Impact**: Low

**What it does**:

- Generic LLM stream adapter (not VSCode-specific)
- Useful for multi-provider normalization

**Current Implementation Gap**: Not needed (VSCode-specific adapter is available)

---

## Integration Roadmap

### Phase 7 (Current): Agent Mode Enhancement

**Use**: Agent loop for better tool coordination

- Replace manual streaming loop with `createAgentLoop()`
- Add `detectDoomLoop()` stop condition
- Track `AgentLoopState.stepIndex` and `consecutiveIdenticalCalls`
- Implement `onStep` callback for progress reporting

### Phase 8 (Next): Tool Invocation Integration

**Use**: Agent loop with tool result callbacks

- Full agent loop implementation
- Tool result message building
- Step-wise thinking display

### Phase 9 (Chat Customization): Thinking Visibility

**Use**: Pipeline transforms for thinking filtering

- `createThinkingFilter()` for toggling visibility
- Compose with existing hideThinkingContent logic
- Cleaner transform abstraction

### Phase 11 (Advanced Features): Cancellation & Recovery

**Use**: Stream state capture and recovery

- `captureStreamState()` on cancellation
- `buildContinuationPrompt()` for resumption
- Provider-aware continuation logic

---

## Implementation Priority

| Feature             | Phase | Priority    | Effort | Impact | Status         |
| ------------------- | ----- | ----------- | ------ | ------ | -------------- |
| Agent Loop          | 7-8   | 🔴 CRITICAL | Medium | High   | ⏳ Recommended |
| VSCode Adapter      | 8     | 🟡 High     | Low    | Medium | ⏳ Recommended |
| Pipeline Transforms | 9     | 🟡 High     | Low    | Medium | ⏳ Recommended |
| State Capture       | 11    | 🟢 Medium   | Medium | Medium | ⏳ Future      |

---

## Code Architecture Impact

**Before (Current)**:

```
provider.ts:streamModelResponse()
├── Manual chunk loop
├── Manual thinking extraction
├── Manual tool call parsing
├── Manual thinking hiding
└── Manual progress reporting
```

**After (With Agent Loop + Adapters)**:

```text
provider.ts:streamModelResponse()
├── createAgentLoop() with VSCodeCopilotAdapter
│   ├── Automated step coordination
│   ├── Automated doom loop detection
│   ├── Structured step results
│   └── AG-UI event tracking
├── createPipeline() with thinking filter
│   └── Composable transforms
└── Recovery module for cancellation
    ├── Stream snapshots
    └── Continuation prompts
```

---

## Migration Strategy

### Step 1: Agent Loop Integration (Immediate)

- Minimal disruption to current streaming
- Replaces manual loop in `src/provider.ts:969+`
- Add test coverage for `detectDoomLoop()` and step tracking

### Step 2: VSCode Adapter Adoption (Secondary)

- Cleaner event protocol handling
- Better thinking/tool call event structure
- Easier future extensions

### Step 3: Pipeline Transforms (Tertiary)

- Thinking visibility in Phase 9
- Smooth output for better UX
- Composable filter architecture

### Step 4: State Recovery (Future)

- Cancellation resilience
- Stream resumption capability
- Error recovery patterns

---

## Risk Assessment

### ✅ Low Risk

- Agent loop: Well-tested, documented, aligns with existing tool coordination
- VSCode adapter: High-level abstraction, minimal breaking changes
- Pipeline: Opt-in transforms, non-breaking

### ⚠️ Medium Risk

- Integration point in critical streaming path
- Need comprehensive testing for tool coordination
- Cancellation token handling must be preserved

### Mitigation

- Implement behind feature flag (Phase 7 agentMode setting)
- Comprehensive test coverage (existing 724 tests as baseline)
- Gradual rollout: agent loop first, adapters second

---

## Recommendation

**Integrate Agent Loop immediately as part of Phase 7-8 work.**

This provides:

- ✅ Doom loop detection (safety improvement)
- ✅ Step tracking (observability improvement)
- ✅ Multi-step tool coordination (feature enablement)
- ✅ AG-UI event support (future extensibility)

**Then layer on VSCode Adapter and Pipeline Transforms** for cleaner architecture and future extensibility.

**Defer State Recovery** to Phase 11 (nice-to-have for cancellation resilience).

---

## Conclusion

We're using approximately **30% of llm-stream-parser v0.3.1's capabilities**. The unused 70% includes:

1. **Agent Loop**: Multi-step coordination and doom loop detection (CRITICAL)
2. **VSCode Adapter**: Cleaner event protocol handling (HIGH)
3. **Pipeline Transforms**: Composable stream filtering (HIGH)
4. **State Recovery**: Cancellation resilience (MEDIUM)

**The agent loop is the highest-impact opportunity** and should be prioritized for Phase 7-8 implementation.
