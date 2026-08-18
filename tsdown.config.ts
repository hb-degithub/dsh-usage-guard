import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['client/index.ts'],
  outDir: 'dist',
  format: ['cjs'],
  platform: 'browser',
  external: ['react', 'react/jsx-runtime'],
  outputOptions: { entryFileNames: 'client.js' },
});
