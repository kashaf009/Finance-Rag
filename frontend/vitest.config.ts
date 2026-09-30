import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    // jsdom so component trees can be rendered and asserted.
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // The api.test.ts integration cases require the backend on 127.0.0.1:8000
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
