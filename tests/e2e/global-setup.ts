import { mkdirSync, writeFileSync } from 'node:fs';
import { PROVIDERS_PORT, startProviders } from './providers';

/**
 * With a local backend, the email, SMS, Stripe and Sentry stand-ins run for the whole test run.
 * At the end, every error report the app and the Edge Functions sent during the run is written to
 * test-results/sentry-reports.json: an unexpected one there is a bug worth a look (T19).
 */
export default async function globalSetup() {
  if (process.env.E2E_BACKEND !== '1') return undefined;
  const stop = await startProviders();
  return async () => {
    try {
      const log = (await (await fetch(`http://127.0.0.1:${PROVIDERS_PORT}/_log`)).json()) as { kind: string }[];
      mkdirSync('test-results', { recursive: true });
      writeFileSync('test-results/sentry-reports.json', JSON.stringify(log.filter((m) => m.kind === 'sentry'), null, 2));
    } finally {
      await stop();
    }
  };
}
