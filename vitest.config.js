import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      vscode: resolve(__dirname, 'src/test/vscode.mock.ts'),
    },
  },
  test: {
    environment: 'node',
    restoreMocks: true,
    exclude: ['node_modules/**', 'dist/**', 'out/**', 'scripts/**', 'test/integration/**'],
    coverage: {
      exclude: ['scripts/**', '**/test/**'],
    }
  },
});
