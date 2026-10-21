import { defineConfig } from 'vite';
import { mp4ExportPlugin } from './scripts/mp4-server.mjs';

export default defineConfig({
  base: './',
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
  plugins: [mp4ExportPlugin()],
});
