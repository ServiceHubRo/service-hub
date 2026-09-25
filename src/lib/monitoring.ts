import {
  buildEvent,
  errorSignature,
  onlyForeignFrames,
  parseDsn,
  parseStack,
  scrubUrl,
  sendEvent,
  type Breadcrumb,
  type EventContext,
  type Level,
} from '../../supabase/functions/_shared/sentry.ts';
import { APP_CONTEXT, APP_RELEASE } from './env';

/**
 * Error reports from the browser to Sentry (T19). On only when the build has `VITE_SENTRY_DSN`
 * (Netlify env var, public like the Supabase anon key); without it every call here does nothing.
 *
 * What is sent: the error, its stack, the page address without tokens, the last screens visited,
 * the user's id and role — never a name, email, phone or anything typed. At most 10 reports per
 * page load and each distinct error once, so a loop cannot flood the project.
 */
const dsn = parseDsn(import.meta.env.VITE_SENTRY_DSN);
const MAX_REPORTS = 10;
const MAX_BREADCRUMBS = 20;

const sent = new Set<string>();
const breadcrumbs: Breadcrumb[] = [];
let user: { id: string; role?: string } | null = null;

export function monitoringEnabled(): boolean {
  return dsn !== null;
}

/** Who is signed in (id and role only), or null after sign-out. */
export function setMonitoringUser(next: { id: string; role?: string } | null): void {
  user = next;
}

/** A step before a possible error: a screen opened, a call that failed. Kept in memory only. */
export function addBreadcrumb(category: string, message: string, level: Level = 'info'): void {
  if (!dsn) return;
  breadcrumbs.push({ timestamp: Date.now() / 1000, category, message: message.slice(0, 300), level });
  if (breadcrumbs.length > MAX_BREADCRUMBS) breadcrumbs.shift();
}

/** Reports an unexpected error. `tags` and `extra` must not hold personal data. */
export function captureError(error: unknown, ctx: Omit<EventContext, 'user' | 'url' | 'userAgent' | 'breadcrumbs'> = {}): void {
  if (!dsn || sent.size >= MAX_REPORTS) return;
  const signature = errorSignature(error);
  if (sent.has(signature)) return;
  sent.add(signature);
  const event = buildEvent(
    error,
    { environment: APP_CONTEXT, release: APP_RELEASE || undefined, tags: { side: 'browser' } },
    {
      ...ctx,
      user,
      url: typeof location !== 'undefined' ? location.href : undefined,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      breadcrumbs: [...breadcrumbs],
    },
  );
  void sendEvent(event, dsn, fetch, { keepalive: true });
}

/** A condition worth knowing about that is not an exception (e.g. the database behind the app). */
export function captureMessage(message: string, ctx: Omit<EventContext, 'user' | 'url' | 'userAgent' | 'breadcrumbs'> = {}): void {
  const error = new Error(message);
  error.name = 'Notice';
  captureError(error, { level: 'warning', ...ctx });
}

// Noise no one can fix: a browser quirk, or a script from another site that hides its error.
const IGNORED_MESSAGES = [/^ResizeObserver loop/, /^Script error\.?$/];

/** Errors nobody caught: thrown in an event handler, or a promise rejected without a handler. */
export function installGlobalHandlers(target: Window = window): void {
  if (!dsn) return;
  target.addEventListener('error', (event: ErrorEvent) => {
    const error: unknown = event.error ?? event.message;
    if (shouldIgnore(error)) return;
    captureError(error, { tags: { mechanism: 'onerror' } });
  });
  target.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const reason: unknown = event.reason;
    if (shouldIgnore(reason)) return;
    captureError(reason, { tags: { mechanism: 'unhandledrejection' } });
  });
}

function shouldIgnore(error: unknown): boolean {
  // Offline, anything can fail; that is the offline bar's job, not a bug.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  // A database answer nobody caught: a business refusal or a lost connection is expected, and an
  // unexpected one was already reported where it was received (failure() in src/data/rpc.ts).
  if (error instanceof Error && error.name === 'RpcError') return true;
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (IGNORED_MESSAGES.some((re) => re.test(message))) return true;
  // A browser extension's own error.
  return error instanceof Error && onlyForeignFrames(parseStack(error.stack));
}

/** The address as it will be reported (no tokens), for breadcrumbs of screen changes. */
export function safePath(href: string): string {
  const url = new URL(scrubUrl(href));
  return `${url.pathname}${url.search}`;
}
