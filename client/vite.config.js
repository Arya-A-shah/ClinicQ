import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development, Vite runs on :5173 and forwards API + socket traffic to the
// Express server on :4000. Same origin = cookies just work, no CORS setup.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:4000',
      '/socket.io': { target: 'http://localhost:4000', ws: true },
    },
  },
});
