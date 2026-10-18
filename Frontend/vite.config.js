import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(() => {
  return {
    server: {
      port: 3006,
      host: '0.0.0.0',
    },
    plugins: [react()],
    // NOTE: Never inject secrets (API keys) into the client bundle via `define`.
    // Anything defined here is embedded in the shipped JavaScript and readable by
    // every visitor. AI/Gemini calls must go through the backend (/api/ai,
    // /api/analytics), which holds the key server-side.
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      }
    },
    build: {
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-charts': ['recharts'],
            'vendor-excel': ['exceljs', 'papaparse'],
            'vendor-pdf': ['jspdf'],
            'vendor-icons': ['lucide-react']
          }
        }
      }
    }
  };
});
