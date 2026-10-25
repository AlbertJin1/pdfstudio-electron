import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    // Keep the default 500 kB warning meaningful: heavyweight document operations are
    // lazy-loaded, while UI libraries are split into stable cacheable vendor chunks.
    rolldownOptions: {
      output: {
        codeSplitting: {
          minSize: 20_000,
          groups: [
            {
              name: 'react-vendor',
              test: /node_modules[\\/](?:react|react-dom|scheduler)(?:[\\/]|$)/,
              priority: 30,
            },
            {
              name: 'motion-vendor',
              test: /node_modules[\\/](?:motion|motion-dom|motion-utils)(?:[\\/]|$)/,
              priority: 25,
            },
            {
              name: 'icons-vendor',
              test: /node_modules[\\/]lucide-react(?:[\\/]|$)/,
              priority: 20,
            },
            {
              name: 'pdfjs-vendor',
              test: /node_modules[\\/]pdfjs-dist(?:[\\/]|$)/,
              minSize: 20_000,
              maxSize: 450_000,
              priority: 18,
            },
            {
              name: 'pdf-lib-vendor',
              test: /node_modules[\\/]pdf-lib(?:[\\/]|$)/,
              minSize: 20_000,
              maxSize: 450_000,
              priority: 17,
            },
            {
              name: 'docx-vendor',
              test: /node_modules[\\/]docx(?:[\\/]|$)/,
              minSize: 20_000,
              maxSize: 450_000,
              priority: 16,
            },
          ],
        },
      },
    },
  },
});
