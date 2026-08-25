import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * The build output is a SINGLE self-contained .html file: script and stylesheet are
 * inlined, so the app can be emailed to a colleague and opened by double-clicking.
 * No install, no server, no internet.
 */
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  base: './',
  build: {
    // Everything in one file; no separate asset requests that file:// would block.
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 4000,
    cssCodeSplit: false,
    // A classic (non-module) script: inline ES modules are fine on file://, but a plain
    // script avoids every browser quirk when the file is opened by double-clicking.
    rollupOptions: { output: { format: 'iife', inlineDynamicImports: true } },
  },
});
