import base from './playwright.config';
import { SENTRY_TEST_DSN } from './tests/e2e/ports';
// A second build on its own port, so these tests run while the visual audit uses the usual one.
const PORT = 4183;
export default {
  ...base,
  testDir: '/home/user/service-hub/tests/e2e',
  use: { ...base.use, baseURL: `http://localhost:${PORT}`, storageState: { cookies: [], origins: [{ origin: `http://localhost:${PORT}`, localStorage: [{ name: 'sh_onboarding_off', value: '1' }] }] } },
  webServer: [{
    command: `cd /home/user/service-hub && VITE_SENTRY_DSN=${SENTRY_TEST_DSN} npx vite build --outDir /tmp/claude-0/va-run/dist-e2e && npx vite preview --outDir /tmp/claude-0/va-run/dist-e2e --port ${PORT} --strictPort`,
    port: PORT, reuseExistingServer: false, timeout: 180_000,
  }],
};
