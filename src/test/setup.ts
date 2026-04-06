import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from '../mocks/node.js';

beforeAll(() =>
  server.listen({
    // Warn (not error) on unhandled requests so that existing tests using
    // vi.doMock('ollama') for SDK-level calls are not broken. Unhandled
    // network requests that slip through will be logged for visibility.
    onUnhandledRequest: 'warn',
  }),
);

afterEach(() => server.resetHandlers());

afterAll(() => server.close());
