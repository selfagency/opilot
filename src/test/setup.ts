import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from '../mocks/node.js';

beforeAll(() =>
  server.listen({
    // Preserve local warning behavior so existing tests using
    // vi.doMock('ollama') for SDK-level calls are not broken, but fail
    // fast in CI to prevent accidental external network calls.
    onUnhandledRequest: process.env.CI ? 'error' : 'warn',
  }),
);

afterEach(() => server.resetHandlers());

afterAll(() => server.close());
