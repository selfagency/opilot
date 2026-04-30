import { Ollama } from 'ollama';
import { Agent, fetch as undiciFetch } from 'undici';
import { ExtensionContext } from 'vscode';
import { getSetting } from './settings.js';

export function getOllamaHost(): string {
  return getSetting<string>('host', 'http://localhost:11434') || 'http://localhost:11434';
}

function getIgnoreSslErrors(): boolean {
  return getSetting<boolean>('ignoreSslErrors', false) ?? false;
}

/**
 * Returns a fetch function that skips TLS certificate verification.
 * Only used when `opilot.ignoreSslErrors` is enabled by the user.
 */
function createInsecureFetch(): typeof globalThis.fetch {
  const agent = new Agent({ connect: { rejectUnauthorized: false } });
  return (input, init) =>
    undiciFetch(input as Parameters<typeof undiciFetch>[0], {
      ...(init as Parameters<typeof undiciFetch>[1]),
      dispatcher: agent,
    }) as Promise<Response>;
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
 * Redact username/password from URL-like host strings for safe display in logs and errors.
 */
export function redactUrlCredentials(urlOrHost: string): string {
  try {
    const parsed = new URL(urlOrHost);
    if (!parsed.username && !parsed.password) {
      return urlOrHost;
    }

    parsed.username = '';
    parsed.password = '';
    return parsed.toString();
  } catch {
    return urlOrHost;
  }
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

  const clientConfig: { host: string; headers?: Record<string, string>; fetch?: typeof globalThis.fetch } = {
    host,
  };

  if (authToken) {
    clientConfig.headers = {
      Authorization: `Bearer ${authToken}`,
    };
  }

  if (getIgnoreSslErrors()) {
    clientConfig.fetch = createInsecureFetch();
  }

  return new Ollama(clientConfig);
}

/**
 * Get an Ollama client for cloud model requests.
 *
 * If the configured host is `https://ollama.com`, this returns a client
 * connecting directly to the cloud API using the authentication token.
 * Otherwise, it returns a client connecting to the configured host (e.g. local server),
 * which handles cloud model requests via credential forwarding (after `ollama login`).
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

export type ConnectionFailureKind = 'timeout' | 'connection-refused' | 'authentication' | 'cancelled' | 'unknown';

export interface ConnectionFailureDetails {
  kind: ConnectionFailureKind;
  message: string;
  error: unknown;
}

function classifyConnectionFailure(error: unknown): ConnectionFailureDetails {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: unknown }).code) : '';
  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? Number((error as { status?: unknown }).status)
      : undefined;
  const name = error instanceof Error ? error.name : '';

  if (code === 'ETIMEDOUT' || normalized.includes('timed out') || normalized.includes('timeout')) {
    return { kind: 'timeout', message, error };
  }

  if (name === 'AbortError') {
    return { kind: 'cancelled', message, error };
  }

  if (code === 'ECONNREFUSED' || normalized.includes('econnrefused') || normalized.includes('connection refused')) {
    return { kind: 'connection-refused', message, error };
  }

  if (status === 401 || status === 403 || normalized.includes('unauthorized') || normalized.includes('forbidden')) {
    return { kind: 'authentication', message, error };
  }

  return { kind: 'unknown', message, error };
}

/**
 * Test connection to Ollama server
 */
export async function testConnection(
  client: Ollama,
  timeoutMs = 5_000,
  onFailure?: (details: ConnectionFailureDetails) => void,
): Promise<boolean> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      client.list(),
      new Promise((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(Object.assign(new Error('Connection timed out'), { code: 'ETIMEDOUT' })),
          timeoutMs,
        );
      }),
    ]);
    return true;
  } catch (error) {
    onFailure?.(classifyConnectionFailure(error));
    return false;
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
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

    // Ollama's output limit is num_predict (default varies by model, typically
    // -1 for unlimited or a model-specific cap). Parse from parameters if set;
    // otherwise use a conservative default that doesn't conflate with context length.
    let maxOutputTokens = 4096;
    if (typeof parameters === 'string') {
      const predictMatch = /num_predict\s+(-?\d+)/m.exec(parameters);
      if (predictMatch) {
        const val = parseInt(predictMatch[1], 10);
        maxOutputTokens = val > 0 ? val : contextLength;
      }
    }

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
