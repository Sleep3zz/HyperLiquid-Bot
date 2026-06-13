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
        ws: true,
      },
    },
  },
  // Production build settings
  define: {
    'import.meta.env.VITE_API_URL': JSON.stringify(
      process.env.VITE_API_URL || 'https://trading.s3zapp.us'
    ),
  },
});
