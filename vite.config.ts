import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: process.env.NODE_ENV === 'production' ? '/CASEVAC_editor/' : './',
  server: {
    watch: {
      // Templates are input assets and may be locked by Office/PDF viewers on Windows.
      ignored: ['**/template/**'],
    },
  },
});
