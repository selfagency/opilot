// Augment the vscode module to add proposed API type support and fix missing declarations.
declare module 'vscode' {
  namespace Uri {
    function joinPath(base: Uri, ...pathSegments: string[]): Uri;
  }

  // LanguageModelTextPart constructor is not declared in older type stubs.
  interface LanguageModelTextPart {
    readonly value: string;
  }
  const LanguageModelTextPart: {
    new (value: string): LanguageModelTextPart;
  };

  // Proposed API: LanguageModelThinkingPart for native thinking content in multi-turn contexts
  interface LanguageModelThinkingPart {
    readonly kind: 'thinking';
    readonly thinking: string;
  }
  const LanguageModelThinkingPart: {
    new (thinking: string): LanguageModelThinkingPart;
  };

  // Proposed API: LanguageModelChatMessage2 supports thinking parts in message history
  interface LanguageModelChatMessage2 {
    role: 'user' | 'assistant';
    content:
      | string
      | LanguageModelTextPart
      | LanguageModelThinkingPart
      | LanguageModelToolCallPart
      | LanguageModelToolResultPart
      | (LanguageModelTextPart | LanguageModelThinkingPart | LanguageModelToolCallPart | LanguageModelToolResultPart)[];
  }

  // registerTool overload used in lmTools.ts (3-argument form).
  type LmToolHandler<I = Record<string, unknown>> = (
    input: I,
    token: CancellationToken,
  ) => Promise<{ content: LanguageModelTextPart[] }>;

  interface LmToolDefinition {
    description: string;
    inputSchema: Record<string, unknown>;
  }

  namespace lm {
    function registerTool(name: string, definition: LmToolDefinition, handler: LmToolHandler): Disposable;
  }

  // Proposed API: Extended ChatResponseStream methods for rich response formatting
  interface ChatResponseStream {
    // Token usage reporting
    usage(tokens: { promptTokens?: number; completionTokens?: number }): void;
    // Native warning part (instead of markdown with ⚠️)
    warning(message: string): void;
    // File references in response
    reference2(uri: Uri): void;
    // Thinking progress (proposed, replaces XML parsing)
    thinkingProgress(progress: { text?: string; id?: string }): void;
    // Confirmation dialog before destructive operations
    confirmation(title: string, message: string, data: Record<string, unknown>): Promise<void>;
    // Tool invocation progress
    beginToolInvocation(toolCallId: string, toolName: string): void;
    updateToolInvocation(toolCallId: string, update: { arguments?: string }): void;
    // File editing (agent mode)
    textEdit(uri: Uri, edits: TextEdit[]): void;
    textEdit(uri: Uri, isDone: boolean): void;
    // Workspace edits for file creation/deletion
    workspaceEdit(edits: Array<{ newResource?: Uri; oldResource?: Uri }>): void;
  }

  // Proposed API: Extended ChatRequest fields for context awareness
  interface ChatRequest {
    // Inline chat location data (ChatRequestEditorData | ChatRequestNotebookData)
    location2?: unknown;
    // Permission level: 'autopilot' | 'autoApprove' | 'normal'
    permissionLevel?: 'autopilot' | 'autoApprove' | 'normal';
    // Custom Copilot mode instructions from .prompt.md
    modeInstructions2?: string[];
    // Recently edited files as workspace context
    editedFileEvents?: { uri: Uri; kind: 'created' | 'changed' | 'deleted' }[];
    // Map of tool names enabled by user in tool picker
    tools?: Map<string, LanguageModelToolInformation>;
    // Request for graceful streaming stop to allow follow-ups
    yieldRequested?: boolean;
    // Confirmation outcomes from previous request
    acceptedConfirmationData?: Record<string, unknown>;
    rejectedConfirmationData?: Record<string, unknown>;
  }

  // Proposed API: Extended ChatParticipant features
  interface ChatParticipant {
    // Generate conversation titles
    titleProvider?: {
      provideChatTitle(firstMessage: string): Promise<string>;
    };
    // Compress long conversation history
    summarizer?: {
      summarizeMessages(messages: LanguageModelChatMessage[]): Promise<string>;
    };
    // Markdown description for /help
    helpTextPrefix?: string;
    // Welcome message with server status
    additionalWelcomeMessage?: string;
    // Suggest follow-up prompts
    followupProvider?: {
      provideFollowups(request: ChatRequest, response: ChatResult): Promise<ChatFollowup[] | undefined>;
    };
    // Model selector variable completions
    participantVariableProvider?: {
      triggerCharacters: string[];
      provideCompletionItems(token: CancellationToken): ProviderResult<ChatCompletionItem[]>;
    };
  }

  // Proposed API: Chat status item for in-chat Ollama status display
  interface ChatStatusItem {
    title?: string;
    description?: string;
    detail?: string;
    isLoading?: boolean;
    command?: Command;
  }

  namespace window {
    function createChatStatusItem(id: string): ChatStatusItem;
  }

  namespace chat {
    function registerChatParticipantDetectionProvider(
      id: string,
      provider: { detectChatParticipant?(input: string): boolean },
    ): Disposable;
    function registerChatSessionCustomizationProvider(
      id: string,
      metadata: { label: string; iconId?: string },
      provider: {
        getCustomizationItems(
          session: ChatSession,
          token: CancellationToken,
        ): ProviderResult<ChatSessionCustomizationItem[]>;
        readonly onDidChange?: Event<void>;
      },
    ): Disposable;
  }

  // Proposed API: Chat session customization for Modelfiles
  enum ChatSessionCustomizationType {
    Agent = 1,
    Personality = 2,
  }

  interface ChatSessionCustomizationItem {
    id: string;
    label: string;
    description?: string;
    type: ChatSessionCustomizationType;
    uri?: Uri;
  }

  // Proposed API: Extended ChatResult for better completion handling
  interface ChatResult {
    metadata?: Record<string, unknown>;
    /** Suggested follow-up prompt to display after the response. */
    nextQuestion?: string;
    /** Brief summary of how the response was generated (model, duration, etc.). */
    details?: string;
  }

  // Proposed API: Chat follow-up suggestions
  interface ChatFollowup {
    prompt: string;
    label?: string;
    tooltip?: string;
  }

  // Proposed API: Language model capabilities
  interface LanguageModelCapabilities {
    capabilities?: string[];
    maxInputTokens?: number;
    maxOutputTokens?: number;
  }
}
