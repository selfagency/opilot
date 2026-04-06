import { setupServer } from 'msw/node';
import { handlers } from './handlers.js';

/**
 * MSW server for Node.js / Vitest.
 * Imported by `src/test/setup.ts` which is listed in `vitest.config.js` setupFiles.
 */
export const server = setupServer(...handlers);
