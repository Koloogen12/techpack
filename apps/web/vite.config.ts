import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Приложение живёт под /app/ за nginx — все ссылки относительные базы.
  base: '/app/',
  server: {
    proxy: { '/app/api': { target: 'http://127.0.0.1:8131', changeOrigin: false } },
  },
  build: { outDir: 'dist', sourcemap: false },
});
