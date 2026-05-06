import { defineConfig } from 'tsup';

const production = process.env.NODE_ENV === 'production';

export default defineConfig({
  entry: ['src/extension.ts', 'src/provider.ts'],
  outDir: 'dist',
  format: ['cjs'],
  platform: 'node',
  external: ['vscode'],
  noExternal: ['ollama', /^@agentsy\//, '@vscode/prompt-tsx'],
  sourcemap: !production,
  minify: production,
  clean: true,
  esbuildOptions(options) {
    options.sourcesContent = false;
  },
});
