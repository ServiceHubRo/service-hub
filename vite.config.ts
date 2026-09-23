import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Netlify sets CONTEXT to "production", "deploy-preview", "branch-deploy" or "dev".
// Anything that is not the production site counts as a test build.
const context = process.env.CONTEXT ?? (process.env.NODE_ENV === 'production' ? 'local-build' : 'dev');

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_CONTEXT__: JSON.stringify(context),
  },
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.{ts,tsx}'],
  },
});
