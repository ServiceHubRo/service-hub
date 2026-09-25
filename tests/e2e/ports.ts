/** Ports of the two preview servers the browser tests start (playwright.config.ts). */
export const PORT = 4173;
export const PUBLISHED_PORT = 4174;

/** Where the browser-test builds send error reports: the Sentry stand-in in providers.ts (T19). */
export const SENTRY_TEST_DSN = 'http://e2e@127.0.0.1:54398/sentry/1';
