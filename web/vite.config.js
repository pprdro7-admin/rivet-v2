import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Locally, scripts/dev.sh runs the database's web API (PostgREST) on :54321. The screens talk to it
// at /rest/v1, the same path Supabase uses, so the code is identical locally and on Supabase.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/rest/v1': { target: 'http://localhost:54321', rewrite: (p) => p.replace(/^\/rest\/v1/, '') },
    },
  },
});
