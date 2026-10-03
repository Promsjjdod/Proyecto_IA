import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const lan = process.env.FORGEAI_LAN === 'true' || process.env.FORGEAI_LAN === '1';
const backendPort = Number(process.env.FORGEAI_PORT || 8000);
const frontendPort = Number(process.env.FORGEAI_FRONTEND_PORT || 3000);

export default defineConfig({
  plugins: [react()],
  server: {
    port: frontendPort,
    strictPort: true,
    // LAN mode (documented): expose the dev server on the local network only.
    host: lan ? '0.0.0.0' : '127.0.0.1',
    // The Arena/preview proxy and custom local hosts must reach the dev server.
    allowedHosts: true,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${backendPort}`,
        changeOrigin: false,
      },
    },
  },
  preview: {
    port: frontendPort,
    strictPort: true,
    host: lan ? '0.0.0.0' : '127.0.0.1',
    allowedHosts: true,
    proxy: {
      '/api': { target: `http://127.0.0.1:${backendPort}`, changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    // Vite 8 (rolldown) handles code-splitting automatically; route pages are
    // already lazy-loaded through dynamic imports.
  },
});
