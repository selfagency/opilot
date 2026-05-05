import { defineConfig } from 'tsup';

const production = process.env.NODE_ENV === 'production';

export default defineConfig({
  entry: ['src/extension.ts', 'src/provider.ts'],
  outDir: 'dist',
  format: ['cjs'],
  platform: 'node',
  external: ['vscode'],
  noExternal: ['ollama', /^@agentsy\/(core|vscode)/],
  sourcemap: !production,
  minify: production,
  clean: true,
  esbuildOptions(options) {
    options.sourcesContent = false;
  },
});
