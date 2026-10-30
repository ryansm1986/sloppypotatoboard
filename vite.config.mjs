import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  root: 'src',
  base: './',
  plugins: [
    svelte({
      // Modals intentionally read their props once when they open.
      onwarn: (w, handler) => w.code !== 'state_referenced_locally' && handler(w),
    }),
  ],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'chrome140',
    chunkSizeWarningLimit: 2000,
  },
});
