import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_URL = process.env.NODE_ENV === 'production' 
  ? 'https://trading.s3zapp.us'
  : 'http://localhost:3456';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': API_URL,
      '/metrics': API_URL,
      '/socket.io': {
        target: API_URL,
        ws: true,
        changeOrigin: true
      }
    }
  }
});
