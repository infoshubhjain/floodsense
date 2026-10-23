import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // build:vercel generates public/ from dist/; it must not be copied back into dist/.
  publicDir: false,
  server: { proxy: { '/api': 'http://localhost:4173' } }
});
