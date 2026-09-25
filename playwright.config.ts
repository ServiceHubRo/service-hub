import { defineConfig, devices } from '@playwright/test';
import { PORT, PUBLISHED_PORT, SENTRY_TEST_DSN } from './tests/e2e/ports';

export default defineConfig({
  testDir: 'tests/e2e',
  // Email and SMS stand-ins for the local backend (T13).
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Dates and times must not depend on the device zone.
    timezoneId: 'Europe/Berlin',
  },
  projects: [
    { name: 'mobile-390', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, hasTouch: true } },
    { name: 'tablet-820', use: { ...devices['Desktop Chrome'], viewport: { width: 820, height: 1180 }, hasTouch: true } },
    { name: 'desktop-1440', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: [
    {
      // Error reports go to the Sentry stand-in (tests/e2e/providers.ts, T19).
      command: `VITE_SENTRY_DSN=${SENTRY_TEST_DSN} npm run build && npx vite preview --port ${PORT} --strictPort`,
      port: PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // The same app built exactly like the published site (Netlify CONTEXT=production).
      command: `CONTEXT=production VITE_SENTRY_DSN=${SENTRY_TEST_DSN} npx vite build --outDir dist-published && npx vite preview --outDir dist-published --port ${PUBLISHED_PORT} --strictPort`,
      port: PUBLISHED_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
