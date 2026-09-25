// Error reports from the Edge Functions to Sentry (T19, Deno only). Needs the SENTRY_DSN secret;
// without it an error only reaches the function's log, as before. The "Deploy Supabase" Action
// sets SENTRY_ENVIRONMENT (`production` on the real project, `test` on the test project) and
// SENTRY_RELEASE (the commit) next to it.
import { buildEvent, parseDsn, sendEvent, type EventContext } from './sentry.ts';

const secret = (name: string): string | undefined => Deno.env.get(name)?.trim() || undefined;
const dsn = parseDsn(secret('SENTRY_DSN'));
const environment = secret('SENTRY_ENVIRONMENT') ?? 'production';
const release = secret('SENTRY_RELEASE');

/**
 * Logs an unexpected failure of `fn` and sends it to Sentry (at most 3 seconds, never throws).
 * Business refusals (not_allowed, a full day …) are answers, not failures: don't report them.
 */
export async function reportError(fn: string, error: unknown, ctx: EventContext = {}): Promise<void> {
  console.error(`${fn} failed`, error instanceof Error ? error.message : error);
  if (!dsn) return;
  const event = buildEvent(error, { environment, release, tags: { side: 'server', function: fn } }, ctx);
  await sendEvent(event, dsn, fetch, { timeoutMs: 3000 });
}
