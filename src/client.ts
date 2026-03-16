import { Ollama } from 'ollama';
import { ExtensionContext } from 'vscode';
import { getSetting } from './settings.js';

export function getOllamaHost(): string {
  return getSetting<string>('host', 'http://localhost:11434') || 'http://localhost:11434';
}

export async function getOllamaAuthToken(context: ExtensionContext): Promise<string | undefined> {
  return context.secrets.get('ollama-auth-token');
}

export async function getOllamaAuthHeaders(context: ExtensionContext): Promise<Record<string, string> | undefined> {
  const authToken = await getOllamaAuthToken(context);
  if (!authToken) {
    return undefined;
  }

  return {
    Authorization: `Bearer ${authToken}`,
  };
}

/**
 * Get or create an Ollama client instance configured with the current settings.
 *
 * Security notes:
 * - The auth token is retrieved from VS Code's `SecretStorage` API (encrypted at
 *   rest) and injected only as an `Authorization: Bearer` HTTP request header.
 * - The token is never logged and cannot appear in Ollama error messages:
 *   the Ollama JS library surfaces `ResponseError` objects containing the server
 *   response body (which does not echo back request headers), and network-level
 *   `TypeError` messages that contain no credentials.
 * - The `host` value is user-controlled via `opilot.host` (with fallback to
 *   legacy `ollama.host`). If a user
 *   embeds credentials in the URL (e.g. `http://user:pass@host`) the URL will
 *   appear in connection-failure error dialogs — users should use the token
 *   mechanism instead.
 */
export async function getOllamaClient(context: ExtensionContext): Promise<Ollama> {
  const host = getOllamaHost();
  const authToken = await getOllamaAuthToken(context);

  const clientConfig: { host: string; headers?: Record<string, string> } = {
    host,
  };

  if (authToken) {
    clientConfig.headers = {
      Authorization: `Bearer ${authToken}`,
    };
  }

  return new Ollama(clientConfig);
}

/**
 * Get an Ollama client for cloud model requests.
 *
 * Cloud usage is login-first (`ollama login`) and routed through the local
 * Ollama server session; no dedicated cloud API key is required.
 */
export async function getCloudOllamaClient(context: ExtensionContext): Promise<Ollama> {
  return getOllamaClient(context);
}

/**
 * Model capabilities detected from Ollama model metadata
 */
export interface ModelCapabilities {
  toolCalling: boolean;
  imageInput: boolean;
  thinking: boolean;
  embedding: boolean;
  maxInputTokens: number;
  maxOutputTokens: number;
}

/**
 * Test connection to Ollama server
 */
export async function testConnection(client: Ollama): Promise<boolean> {
  try {
    await client.list();
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetch and parse model capabilities from an Ollama model
 * by inspecting the template and families metadata
 */
export async function fetchModelCapabilities(client: Ollama, modelId: string): Promise<ModelCapabilities> {
  try {
    const modelInfo = await client.show({ model: modelId });

    // Default capabilities
    let toolCalling = false;
    let imageInput = false;

    // Check template for tool support by looking for {{ .Tools }}
    if (modelInfo.template && modelInfo.template.includes('{{ .Tools }}')) {
      toolCalling = true;
    }

    // Check families for vision/image support (CLIP requires 'clip' family)
    // Also check details.families if available
    const families = modelInfo.details?.families || [];
    if (families.includes('clip') || modelInfo.template?.includes('vision')) {
      imageInput = true;
    }

    // Detect the actual context window from model_info (family-specific keys like
    // llama.context_length, qwen2.context_length, etc.) with a num_ctx fallback,
    // mirroring the logic in OllamaChatModelProvider.getChatModelInfo().
    const typedInfo = modelInfo as typeof modelInfo & {
      model_info?: Record<string, unknown> | Map<string, unknown>;
      modelinfo?: Record<string, unknown> | Map<string, unknown>;
    };
    const modelInfoData = typedInfo.model_info ?? typedInfo.modelinfo;
    const parameters = (modelInfo as typeof modelInfo & { parameters?: string }).parameters;
    let contextLength = 4096; // Conservative default

    let infoCtx: unknown;
    if (modelInfoData instanceof Map) {
      for (const [key, value] of modelInfoData.entries()) {
        if (key === 'context_length' || key.endsWith('.context_length')) {
          infoCtx = value;
          break;
        }
      }
    } else if (modelInfoData && typeof modelInfoData === 'object') {
      for (const [key, value] of Object.entries(modelInfoData)) {
        if (key === 'context_length' || key.endsWith('.context_length')) {
          infoCtx = value;
          break;
        }
      }
    }

    if (typeof infoCtx === 'number' && infoCtx > 0) {
      contextLength = infoCtx;
    } else if (typeof parameters === 'string') {
      const match = /^num_ctx\s+(\d+)/m.exec(parameters);
      if (match) contextLength = parseInt(match[1], 10);
    }

    const maxInputTokens = contextLength;
    const maxOutputTokens = contextLength;

    // Detect thinking support from capabilities array or template
    const capabilitiesArr = (modelInfo as unknown as Record<string, unknown>).capabilities;
    const capsArray = Array.isArray(capabilitiesArr) ? capabilitiesArr : [];
    const thinking = capsArray.some((c: unknown) => typeof c === 'string' && c.toLowerCase() === 'thinking');

    // Detect embedding models by checking for bert family or embedding-related families
    const embedding = families.some(f => /bert|embed/i.test(f)) || (!modelInfo.template && families.length > 0);

    return {
      toolCalling,
      imageInput,
      thinking,
      embedding,
      maxInputTokens,
      maxOutputTokens,
    };
  } catch {
    // If we can't fetch model info, return conservative defaults
    return {
      toolCalling: false,
      imageInput: false,
      thinking: false,
      embedding: false,
      maxInputTokens: 2048,
      maxOutputTokens: 2048,
    };
  }
}
