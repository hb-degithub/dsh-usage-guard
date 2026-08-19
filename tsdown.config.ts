import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['client/index.ts'],
  outDir: 'dist',
  format: ['cjs'],
  platform: 'browser',
  external: ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'],
  outputOptions: { entryFileNames: 'client.js' },
});
