import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Dev proxy: the browser calls /api/* on its OWN origin and Vite forwards
    // to the API. This makes the httpOnly refresh cookie first-party (no
    // cross-origin cookie quirks, no localhost-vs-127.0.0.1 origin mismatch)
    // and makes CORS irrelevant in local development. The API client's
    // default BASE_URL is the relative '/api/v1' to match.
    proxy: {
      '/api': {
        // The session-expiry e2e boots its own API on an alternate port
        // (short session TTL) — override without touching the default.
        target: process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './tests/setup.js',
    // The Playwright E2E specs (e2e/) belong to Playwright's own runner
    // (playwright.config.mjs) — vitest must not sweep them up (a spec file
    // crashing vitest with "did not expect test.describe() to be called here").
    exclude: ['**/node_modules/**', 'e2e/**'],
  },
});
