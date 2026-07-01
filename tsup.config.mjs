import { defineConfig } from 'tsup';

const production = process.env.NODE_ENV === 'production';

export default defineConfig({
  entry: ['src/extension.ts', 'src/provider.ts'],
  outDir: 'dist',
  format: ['cjs'],
  platform: 'node',
  external: ['vscode'],
  // Bundle all @agentsy/* packages to avoid leaving runtime requires in the published
  // extension (VS Code extensions do not ship node_modules). This mirrors prior
  // fixes for undici and other packages that must be bundled.
  noExternal: ['ollama', 'undici', /^@agentsy\//],
  sourcemap: !production,
  minify: production,
  clean: true,
  esbuildOptions(options) {
    options.sourcesContent = false;
  }
});
