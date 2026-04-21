import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.VITE_BASE_URL ?? '/',
  build: {
    target: 'esnext',
  },
  optimizeDeps: {
    exclude: ['@huggingface/transformers'],
  },
});
