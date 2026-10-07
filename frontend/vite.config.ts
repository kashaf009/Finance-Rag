import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

function apiPreconnect(): Plugin {
  let apiOrigin: string | undefined

  return {
    name: 'api-preconnect',
    configResolved({ env }) {
      try {
        // Match the API client fallback in src/lib/api.ts.
        const apiBase = env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8000'
        const protocolRelative = apiBase.startsWith('//')
        const url = new URL(protocolRelative ? `http:${apiBase}` : apiBase)
        if (url.protocol === 'http:' || url.protocol === 'https:') {
          apiOrigin = protocolRelative ? `//${url.host}` : url.origin
        }
      } catch {
        // Empty and relative API bases use the document's existing connection.
      }
    },
    transformIndexHtml() {
      return apiOrigin
        ? [
            {
              tag: 'link',
              attrs: { rel: 'preconnect', href: apiOrigin, crossorigin: '' },
              injectTo: 'head-prepend',
            },
          ]
        : []
    },
  }
}

export default defineConfig({
  plugins: [react(), apiPreconnect()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-markdown': ['react-markdown', 'remark-gfm'],
        },
      },
    },
  },
})
