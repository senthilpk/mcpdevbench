import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue({})],
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
  test: {
    environment: 'jsdom',
    exclude: [
      'tests/e2e/**',
      '.worktrees/**',
      '**/node_modules/**',
      '**/.git/**',
    ],
    setupFiles: ['tests/setup/renderer.ts'],
  },
});
