import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/demos/procedural/',
  worker: {
    format: 'es',
    rollupOptions: {
      output: {
        assetFileNames: '[name].[hash][extname]',
        chunkFileNames: '[name].[hash].js',
        entryFileNames: '[name].[hash].js'
      }
    }
  },
  build: {
    rollupOptions: {
      output: {
        assetFileNames: 'assets/[name].[hash][extname]',
        chunkFileNames: 'assets/[name].[hash].js',
        entryFileNames: 'assets/[name].[hash].js'
      }
    }
  }
});
