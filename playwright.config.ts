import { defineConfig, devices } from '@playwright/test';
import { PORT, PUBLISHED_PORT, SENTRY_TEST_DSN } from './tests/e2e/ports';

export default defineConfig({
  testDir: 'tests/e2e',
  // Email and SMS stand-ins for the local backend (T13).
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: true,
  // Two at a time on CI: Playwright's default (half the processors) gave one on a two-processor
  // runner, and the suite then outlasted the job's time limit (Oct 2026).
  workers: process.env.CI ? 2 : undefined,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Dates and times must not depend on the device zone.
    timezoneId: 'Europe/Berlin',
    // The app's animations (src/lib/motion.ts) off, as for a phone with "Reduce motion": a figure
    // read at once is its value, not a step of the count. public.spec.ts checks them with motion on.
    contextOptions: { reducedMotion: 'reduce' },
    // No tour and no "Primii pași" on fresh accounts (T39); tests/e2e/onboarding.spec.ts shows them.
    storageState: {
      cookies: [],
      origins: [PORT, PUBLISHED_PORT].map((port) => ({
        origin: `http://localhost:${port}`,
        localStorage: [{ name: 'sh_onboarding_off', value: '1' }],
      })),
    },
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
      command: `CONTEXT=production VITE_SENTRY_DSN=${SENTRY_TEST_DSN} npx vite build --outDir dist-published && node scripts/prerender.mjs dist-published && npx vite preview --outDir dist-published --port ${PUBLISHED_PORT} --strictPort`,
      port: PUBLISHED_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
