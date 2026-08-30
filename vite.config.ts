import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import tailwindcss from '@tailwindcss/vite';
// @ts-ignore
import basicSsl from '@vitejs/plugin-basic-ssl';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    basicSsl(),
  ],
  build: {
    rollupOptions: {
      output: {
        // three.js is the bulk of the bundle and changes far less often than app code,
        // so splitting it lets it stay cached across deploys.
        manualChunks: {
          three: ['three'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
  server: {
    port: 4000,
    host: true, // expose on local network for mobile testing
  },
});

