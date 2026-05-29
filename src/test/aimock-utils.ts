import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Fixture, LLMock } from '@copilotkit/aimock';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export function loadFixture(filename: string): Fixture[] {
  const path = resolve(__dirname, '..', '..', 'test', 'fixtures', filename);
  const content = readFileSync(path, 'utf-8');
  return JSON.parse(content) as Fixture[];
}

export function createOllamaMock(options?: { port?: number; fixtures?: string[] }): LLMock {
  const mock = new LLMock({ port: options?.port ?? 0 });
  const fixtureFiles = options?.fixtures ?? ['ollama-chat.json', 'ollama-embeddings.json', 'ollama-errors.json'];

  for (const filename of fixtureFiles) {
    mock.addFixturesFromJSON(readFileSync(resolve(__dirname, '..', '..', 'test', 'fixtures', filename), 'utf-8'));
  }

  return mock;
}

export function setupOllamaEnv(mockUrl: string): void {
  process.env.OLLAMA_HOST = mockUrl;
}

export function restoreOllamaEnv(originalHost?: string): void {
  if (originalHost) {
    process.env.OLLAMA_HOST = originalHost;
  } else {
    delete process.env.OLLAMA_HOST;
  }
}

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
    async beforeAll(): Promise<void> {
      originalHost = process.env.OLLAMA_HOST;
      mock = createOllamaMock(options);
      await mock.start();
      setupOllamaEnv(mock.url);
    },
    async afterAll(): Promise<void> {
      if (mock) {
        await mock.stop();
      }
      restoreOllamaEnv(originalHost);
    }
  };
}

export function addCustomFixture(mock: LLMock, fixture: Fixture): void {
  mock.addFixture(fixture);
}

export function createChatFixture(
  model: string,
  userMessage: string,
  assistantResponse: string,
  options?: { status?: number; totalDuration?: number; evalCount?: number }
) {
  return {
    match: { method: 'POST', path: '/api/chat', body: { model, messages: [{ role: 'user', content: userMessage }] } },
    response: {
      model,
      created_at: new Date().toISOString(),
      message: { role: 'assistant', content: assistantResponse },
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

export function createEmbeddingsFixture(model: string, prompt: string, embeddingDimension = 20) {
  return {
    match: { method: 'POST', path: '/api/embeddings', body: { model, prompt } },
    response: { model, embeddings: Array.from({ length: embeddingDimension }, (_, i) => i / 10) }
  };
}

export function createErrorFixture(method: string, path: string, errorMessage: string, status = 500) {
  return { match: { method, path }, response: { error: errorMessage }, status };
}
