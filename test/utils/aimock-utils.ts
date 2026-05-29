/**
 * Aimock test utilities for Opilot
 *
 * Provides helpers to set up and manage aimock mock server for Ollama testing.
 * Integrates with Vitest for automatic lifecycle management.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Fixture, LLMock } from '@copilotkit/aimock';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/**
 * Load fixture file from test/fixtures directory
 */
export function loadFixture(filename: string): Fixture[] {
  const path = resolve(__dirname, '..', 'fixtures', filename);
  const content = readFileSync(path, 'utf-8');
  return JSON.parse(content) as Fixture[];
}

/**
 * Create and configure an aimock instance for Ollama testing
 */
export function createOllamaMock(options?: { port?: number; fixtures?: string[] }): LLMock {
  const mock = new LLMock({ port: options?.port ?? 0 });

  // Load default fixtures if not specified
  const fixtureFiles = options?.fixtures ?? ['ollama-chat.json', 'ollama-embeddings.json', 'ollama-errors.json'];

  for (const filename of fixtureFiles) {
    mock.addFixturesFromJSON(readFileSync(resolve(__dirname, '..', 'fixtures', filename), 'utf-8'));
  }

  return mock;
}

/**
 * Set up environment variables for Ollama client to use aimock
 */
export function setupOllamaEnv(mockUrl: string): void {
  process.env.OLLAMA_HOST = mockUrl;
}

/**
 * Restore original environment variables
 */
export function restoreOllamaEnv(originalHost?: string): void {
  if (originalHost) {
    process.env.OLLAMA_HOST = originalHost;
  } else {
    delete process.env.OLLAMA_HOST;
  }
}

/**
 * Vitest hook for automatic aimock lifecycle
 *
 * Usage:
 * ```typescript
 * import { useOllamaMock } from './test-utils';
 *
 * describe('Ollama Integration', () => {
 *   const { mock, mockUrl } = useOllamaMock();
 *
 *   it('should handle chat', async () => {
 *     // mock is started and env is configured
 *     // OLLAMA_HOST points to mock.url
 *   });
 * });
 * ```
 */
export function useOllamaMock(options?: { port?: number; fixtures?: string[] }) {
  let mock: LLMock | null = null;
  let originalHost: string | undefined;

  return {
    get mock(): LLMock {
      if (!mock) {
        throw new Error('Mock not initialized. Did you call beforeAll?');
      }
      return mock;
    },
    get mockUrl(): string {
      return this.mock.url;
    },
    async beforeAll() {
      originalHost = process.env.OLLAMA_HOST;
      mock = createOllamaMock(options);
      await mock.start();
      setupOllamaEnv(mock.url);
    },
    async afterAll() {
      if (mock) {
        await mock.stop();
      }
      restoreOllamaEnv(originalHost);
    }
  };
}

/**
 * Add a custom fixture to the mock at runtime
 */
export function addCustomFixture(mock: LLMock, fixture: Fixture): void {
  mock.addFixture(fixture);
}

/**
 * Create a chat fixture for testing
 */
export function createChatFixture(
  model: string,
  userMessage: string,
  assistantResponse: string,
  options?: {
    status?: number;
    totalDuration?: number;
    evalCount?: number;
  }
) {
  return {
    match: {
      method: 'POST',
      path: '/api/chat',
      body: {
        model,
        messages: [
          {
            role: 'user',
            content: userMessage
          }
        ]
      }
    },
    response: {
      model,
      created_at: new Date().toISOString(),
      message: {
        role: 'assistant',
        content: assistantResponse
      },
      done: true,
      total_duration: options?.totalDuration ?? 1_000_000_000,
      load_duration: 500_000_000,
      prompt_eval_count: userMessage.split(' ').length,
      prompt_eval_duration: 300_000_000,
      eval_count: options?.evalCount ?? assistantResponse.split(' ').length,
      eval_duration: 200_000_000
    },
    status: options?.status ?? 200
  };
}

/**
 * Create an embeddings fixture for testing
 */
export function createEmbeddingsFixture(model: string, prompt: string, embeddingDimension = 20) {
  return {
    match: {
      method: 'POST',
      path: '/api/embeddings',
      body: {
        model,
        prompt
      }
    },
    response: {
      model,
      embeddings: Array.from({ length: embeddingDimension }, (_, i) => i / 10)
    }
  };
}

/**
 * Create an error fixture for testing error handling
 */
export function createErrorFixture(method: string, path: string, errorMessage: string, status = 500) {
  return {
    match: {
      method,
      path
    },
    response: {
      error: errorMessage
    },
    status
  };
}
