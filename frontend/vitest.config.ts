import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // The api.test.ts integration cases require the backend on 127.0.0.1:8000
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
