import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const host = process.env.HOST || env.HOST || '0.0.0.0';
  return {
    root: 'web',
    plugins: [react()],
    server: {
      host,
      allowedHosts: ['.e2b.app', 'localhost', '127.0.0.1'],
      proxy: { '/api': 'http://127.0.0.1:4000' },
    },
    build: { outDir: '../dist', emptyOutDir: true },
  };
});
