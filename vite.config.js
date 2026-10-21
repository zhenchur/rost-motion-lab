import { defineConfig } from 'vite';
import { mp4ExportPlugin } from './scripts/mp4-server.mjs';

export default defineConfig({
  base: './',
  // Keep dependency copyright/license notices in both dist and the offline HTML.
  esbuild: { legalComments: 'inline' },
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
  plugins: [mp4ExportPlugin()],
});
