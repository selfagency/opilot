/**
 * Example tests using aimock for Ollama mocking
 *
 * These tests demonstrate how to use aimock fixtures to test Opilot
 * without requiring a running Ollama server.
 *
 * Run with: npx vitest run test/aimock-examples.test.ts
 */

import { Ollama } from 'ollama';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addCustomFixture,
  createChatFixture,
  createEmbeddingsFixture,
  createErrorFixture,
  useOllamaMock
} from './utils/aimock-utils';

describe('Aimock Ollama Mocking Examples', () => {
  const { mock, mockUrl } = useOllamaMock();

  beforeAll(async () => {
    await mock.beforeAll();
  });

  afterAll(async () => {
    await mock.afterAll();
  });

  describe('Chat Completions', () => {
    it('should mock basic chat response', async () => {
      const client = new Ollama({ host: mockUrl });

      const response = await client.chat({
        model: 'smollm:135m',
        messages: [{ role: 'user', content: 'hello' }],
        stream: false
      });

      expect(response.message.content).toBe('Hello! How can I help you today?');
      expect(response.model).toBe('smollm:135m');
    });

    it('should mock code generation', async () => {
      const client = new Ollama({ host: mockUrl });

      const response = await client.chat({
        model: 'smollm:135m',
        messages: [{ role: 'user', content: 'write a function' }],
        stream: false
      });

      expect(response.message.content).toContain('function');
      expect(response.message.content).toContain('greet');
    });

    it('should handle custom fixtures at runtime', async () => {
      const customFixture = createChatFixture('custom-model', 'test prompt', 'Custom response from fixture');

      addCustomFixture(mock.mock, customFixture);

      const client = new Ollama({ host: mockUrl });
      const response = await client.chat({
        model: 'custom-model',
        messages: [{ role: 'user', content: 'test prompt' }],
        stream: false
      });

      expect(response.message.content).toBe('Custom response from fixture');
    });
  });

  describe('Embeddings', () => {
    it('should mock embeddings response', async () => {
      const client = new Ollama({ host: mockUrl });

      const response = await client.embeddings({
        model: 'smollm:135m',
        prompt: 'hello world'
      });

      expect(response.embedding).toBeDefined();
      expect(Array.isArray(response.embedding)).toBe(true);
      expect(response.embedding.length).toBeGreaterThan(0);
    });

    it('should create embeddings fixture dynamically', async () => {
      const fixture = createEmbeddingsFixture('test-model', 'dynamic test', 512);

      addCustomFixture(mock.mock, fixture);

      const client = new Ollama({ host: mockUrl });
      const response = await client.embeddings({
        model: 'test-model',
        prompt: 'dynamic test'
      });

      expect(response.embedding.length).toBe(512);
    });
  });

  describe('Error Handling', () => {
    it('should handle 404 errors', async () => {
      const errorFixture = createErrorFixture('POST', '/api/chat', "model 'nonexistent' not found", 404);

      addCustomFixture(mock.mock, errorFixture);

      const client = new Ollama({ host: mockUrl });

      await expect(
        client.chat({
          model: 'nonexistent',
          messages: [{ role: 'user', content: 'test' }],
          stream: false
        })
      ).rejects.toThrow();
    });

    it('should handle 500 errors', async () => {
      const errorFixture = createErrorFixture('POST', '/api/chat', 'Internal server error', 500);

      addCustomFixture(mock.mock, errorFixture);

      const client = new Ollama({ host: mockUrl });

      await expect(
        client.chat({
          model: 'error-model',
          messages: [{ role: 'user', content: 'test' }],
          stream: false
        })
      ).rejects.toThrow();
    });
  });

  describe('Model Listing', () => {
    it('should mock model list endpoint', async () => {
      const client = new Ollama({ host: mockUrl });

      const models = await client.list();

      expect(models.models).toBeDefined();
      expect(Array.isArray(models.models)).toBe(true);
    });
  });
});
