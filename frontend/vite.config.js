import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3456',
      '/metrics': 'http://localhost:3456',
      '/socket.io': {
        target: 'http://localhost:3456',
        ws: true
      }
    }
  }
});
