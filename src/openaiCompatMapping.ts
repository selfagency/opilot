import type { Message, Tool } from 'ollama';

export interface OpenAICompatContentTextPart {
  type: 'text';
  text: string;
}

export interface OpenAICompatContentImagePart {
  type: 'image_url';
  image_url: {
    url: string;
  };
}

export type OpenAICompatContentPart = OpenAICompatContentTextPart | OpenAICompatContentImagePart;

export interface OpenAICompatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | OpenAICompatContentPart[];
  tool_calls?: Array<{
    id?: string;
    type?: 'function';
    function?: {
      name?: string;
      arguments?: string;
    };
  }>;
  tool_call_id?: string;
}

export interface OpenAICompatTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

function mapRole(role: string | undefined): OpenAICompatMessage['role'] {
  switch (role) {
    case 'system':
      return 'system';
    case 'assistant':
      return 'assistant';
    case 'tool':
      return 'tool';
    case 'user':
    default:
      return 'user';
  }
}

/**
 * Convert base64 image strings from Ollama message shape to OpenAI-compatible
 * content parts using data URLs.
 */
function imagesToOpenAIContentParts(images: Array<string | Uint8Array>): OpenAICompatContentImagePart[] {
  return images.map(img => ({
    type: 'image_url',
    image_url: {
      // Mime type cannot be recovered from Ollama's message image payload.
      // Use png as a safe default data URL type.
      url: `data:image/png;base64,${typeof img === 'string' ? img : Buffer.from(img).toString('base64')}`,
    },
  }));
}

export function ollamaMessagesToOpenAICompat(messages: readonly Message[]): OpenAICompatMessage[] {
  return messages.map(msg => {
    const role = mapRole(msg.role);
    const text = msg.content ?? '';

    let content: string | OpenAICompatContentPart[] = text;
    if (role === 'user' && Array.isArray(msg.images) && msg.images.length > 0) {
      const parts: OpenAICompatContentPart[] = [];
      if (text.trim()) {
        parts.push({ type: 'text', text });
      }
      parts.push(...imagesToOpenAIContentParts(msg.images));
      content = parts;
    }

    const out: OpenAICompatMessage = {
      role,
      content,
    };

    if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      out.tool_calls = msg.tool_calls.map(call => ({
        id: (call as { id?: string }).id,
        type: 'function',
        function: {
          name: call.function?.name,
          arguments: JSON.stringify(call.function?.arguments ?? {}),
        },
      }));
    }

    if (role === 'tool' && (msg as Message & { tool_call_id?: string }).tool_call_id) {
      out.tool_call_id = (msg as Message & { tool_call_id?: string }).tool_call_id;
    }

    return out;
  });
}

export function ollamaToolsToOpenAICompat(tools?: readonly Tool[]): OpenAICompatTool[] | undefined {
  if (!tools?.length) {
    return undefined;
  }

  const mapped: OpenAICompatTool[] = [];
  for (const tool of tools) {
    if (tool.type !== 'function' || typeof tool.function?.name !== 'string') {
      continue;
    }

    mapped.push({
      type: 'function',
      function: {
        name: tool.function.name,
        description: tool.function.description,
        parameters:
          tool.function.parameters && typeof tool.function.parameters === 'object'
            ? (tool.function.parameters as Record<string, unknown>)
            : undefined,
      },
    });
  }

  return mapped;
}
