import { mkdirSync, writeFileSync } from 'node:fs';
import { PROVIDERS_PORT, startProviders } from './providers';

/**
 * With a local backend, the email, SMS, Stripe and Sentry stand-ins run for the whole test run.
 * At the end, every error report the app and the Edge Functions sent during the run is written to
 * test-results/sentry-reports.json: an unexpected one there is a bug worth a look (T19).
 */
export default async function globalSetup() {
  if (process.env.E2E_BACKEND !== '1') return undefined;
  // Every test makes shops (most in Brașov): keep the launch price open for the whole run (the SQL
  // tests check the places per city), so the landing page always shows it.
  // No quiet hours either (T24): the tests run at any hour and expect every email and push at once.
  const key = process.env.E2E_SERVICE_ROLE_KEY ?? '';
  const url = `${process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321'}/rest/v1/platform_settings?id=eq.1`;
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const current = (await (await fetch(`${url}&select=limits`, { headers })).json()) as { limits: Record<string, number> }[];
  const res = await fetch(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      launch_slots_per_city: 100000,
      limits: { ...(current[0]?.limits ?? {}), quiet_hours_start: 0, quiet_hours_end: 0 },
    }),
  });
  if (!res.ok) throw new Error(`global setup: launch places not set (${res.status} ${await res.text()})`);
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
