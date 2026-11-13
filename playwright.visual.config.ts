import { defineConfig, devices } from '@playwright/test';
import { PORT, SENTRY_TEST_DSN } from './tests/e2e/ports';

/**
 * A9 — the visual audit (tests/visual): every screen of every role at seven widths, screenshots and
 * measurements in visual-audit/. Not part of `npm run test:e2e`; needs the local Supabase stack.
 */
export default defineConfig({
  testDir: 'tests/visual',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: true,
  workers: process.env.CI ? 4 : undefined,
  retries: 0,
  timeout: 45 * 60_000,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    timezoneId: 'Europe/Berlin',
    contextOptions: { reducedMotion: 'reduce' },
    storageState: {
      cookies: [],
      origins: [{ origin: `http://localhost:${PORT}`, localStorage: [{ name: 'sh_onboarding_off', value: '1' }] }],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: [
    {
      command: `VITE_SENTRY_DSN=${SENTRY_TEST_DSN} npm run build && npx vite preview --port ${PORT} --strictPort`,
      port: PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
