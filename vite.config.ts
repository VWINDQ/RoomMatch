import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    proxy: {
      '/api': `http://127.0.0.1:${loadEnv(mode, '.', 'ROOMMATCH_').ROOMMATCH_PORT || '3001'}`,
    },
  },
}));
