import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          const norm = id.replace(/\\/g, '/')
          if (norm.includes('/echarts/') || norm.includes('/zrender/')) return 'charts'
          if (norm.includes('@tanstack/react-query')) return 'react-query'
          if (norm.includes('react-router')) return 'router'
          if (norm.includes('/react/') || norm.includes('/react-dom/')) return 'react-vendor'
          return 'vendor'
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
      '/healthz': {
        target: apiProxyTarget,
        changeOrigin: true,
      },
      '/readyz': {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
  },
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
