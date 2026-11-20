import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
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
});
