// Error reports to Sentry (T19) without the Sentry SDK: the app and the Edge Functions build the
// same small event and send it as one "envelope" (https://develop.sentry.dev/sdk/envelopes/).
// Pure: no Deno and no DOM, so the browser, the functions and the unit tests share it.
//
// Nothing personal leaves: the user is only their id and role, addresses lose their tokens
// (email links carry the session in `#access_token=…`, invitations in `/invitatie/<token>`), and
// emails, phone numbers and access tokens in messages are replaced before sending.

export interface SentryDsn {
  /** The public key (the DSN's user part). */
  publicKey: string;
  /** Where events are sent: `https://o1.ingest.de.sentry.io/api/2/envelope/?…`. */
  envelopeUrl: string;
  /** The DSN as given, repeated in the envelope header. */
  dsn: string;
}

/** `https://<key>@<host>/<project>` → where to send, or null when it is not a DSN. */
export function parseDsn(value: string | null | undefined): SentryDsn | null {
  const raw = (value ?? '').trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol) || !url.username) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  const projectId = parts.pop();
  if (!projectId || !/^\d+$/.test(projectId)) return null;
  const prefix = parts.length ? `/${parts.join('/')}` : '';
  const query = `sentry_version=7&sentry_key=${encodeURIComponent(url.username)}&sentry_client=service-hub%2F1.0`;
  return {
    publicKey: url.username,
    envelopeUrl: `${url.protocol}//${url.host}${prefix}/api/${projectId}/envelope/?${query}`,
    dsn: raw,
  };
}

// ------------------------------------------------------------------------------------ scrubbing

const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
const JWT = /eyJ[\w-]{6,}\.[\w-]{6,}\.[\w-]+/g;
// Romanian numbers as typed or stored: +40 7xx xxx xxx, 07xx xxx xxx (spaces, dots or dashes).
const PHONE = /(\+40|\b0)[\s.-]?7\d{2}[\s.-]?\d{3}[\s.-]?\d{3}\b/g;
const SECRET_PARAMS = /^(access_token|refresh_token|provider_token|provider_refresh_token|token|token_hash|code|email|phone)$/i;

/** Removes emails, phone numbers and access tokens from a text (messages, breadcrumbs). */
export function scrubText(text: string): string {
  return text.replace(JWT, '[token]').replace(EMAIL, '[email]').replace(PHONE, '[phone]');
}

/**
 * An address without anything that grants access or names a person: no `#…` part (email links
 * carry the session there), no token / email query values, no invitation token in the path.
 */
export function scrubUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return scrubText(value.replace(/#.*$/, ''));
  }
  url.hash = '';
  url.username = '';
  url.password = '';
  url.pathname = url.pathname.replace(/\/invitatie\/[^/]+/, '/invitatie/[token]');
  for (const key of [...url.searchParams.keys()]) {
    if (SECRET_PARAMS.test(key)) url.searchParams.set(key, '[filtered]');
  }
  return scrubText(url.toString());
}

// ------------------------------------------------------------------------------------ stack traces

export interface StackFrame {
  function?: string;
  abs_path?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
}

// V8 (Chrome, Edge, Deno, Node): "    at fn (https://x/a.js:1:2)" or "    at https://x/a.js:1:2".
const V8_LINE = /^\s*at (?:(.+?) \()?(?:async )?(.+?):(\d+):(\d+)\)?\s*$/;
// Firefox and Safari: "fn@https://x/a.js:1:2", "@https://x/a.js:1:2".
const GECKO_LINE = /^\s*(.*?)@(.+?):(\d+):(\d+)\s*$/;
const NOT_OURS = /^(chrome|moz|safari|safari-web)-extension:|^ext:|^node:|\/node_modules\//;

function frame(fn: string | undefined, path: string, line: string, col: string): StackFrame {
  const absPath = scrubUrl(path);
  const filename = absPath.replace(/^[a-z]+:\/\/[^/]*/i, '').replace(/[?#].*$/, '') || absPath;
  return {
    function: fn && fn !== '' ? fn : '?',
    abs_path: absPath,
    filename,
    lineno: Number(line),
    colno: Number(col),
    in_app: !NOT_OURS.test(path),
  };
}

/** A stack string → Sentry frames, oldest call first (the crashing frame last). */
export function parseStack(stack: string | undefined | null): StackFrame[] {
  if (!stack) return [];
  const frames: StackFrame[] = [];
  for (const line of stack.split('\n').slice(0, 60)) {
    const v8 = V8_LINE.exec(line);
    if (v8) {
      frames.push(frame(v8[1], v8[2]!, v8[3]!, v8[4]!));
      continue;
    }
    const gecko = GECKO_LINE.exec(line);
    if (gecko) frames.push(frame(gecko[1], gecko[2]!, gecko[3]!, gecko[4]!));
  }
  return frames.reverse();
}

/** Whether a stack comes only from a browser extension (not ours to fix). */
export function onlyForeignFrames(frames: StackFrame[]): boolean {
  return frames.length > 0 && frames.every((f) => f.in_app === false);
}

// ------------------------------------------------------------------------------------ events

export type Level = 'fatal' | 'error' | 'warning' | 'info';

export interface Breadcrumb {
  /** Seconds since 1970. */
  timestamp: number;
  category: string;
  message: string;
  level?: Level;
}

export interface EventBase {
  /** `production`, `deploy-preview`, `test` … */
  environment: string;
  /** The commit the code was built from, when known. */
  release?: string;
  /** Tags on every event of this sender (`side: browser`, `function: stripe-webhook`). */
  tags?: Record<string, string>;
}

export interface EventContext {
  level?: Level;
  tags?: Record<string, string>;
  /** Small, non-personal details (a function name, an HTTP status). */
  extra?: Record<string, unknown>;
  user?: { id: string; role?: string } | null;
  /** The page or request the error happened on (scrubbed here). */
  url?: string;
  userAgent?: string;
  breadcrumbs?: Breadcrumb[];
  /** Groups events that belong together although their messages differ. */
  fingerprint?: string[];
}

export interface SentryEvent {
  event_id: string;
  timestamp: number;
  platform: 'javascript';
  level: Level;
  environment: string;
  release?: string;
  tags: Record<string, string>;
  extra?: Record<string, unknown>;
  user?: { id: string; role?: string };
  request?: { url?: string; headers?: Record<string, string> };
  breadcrumbs?: { values: Breadcrumb[] };
  fingerprint?: string[];
  exception: { values: { type: string; value: string; stacktrace?: { frames: StackFrame[] } }[] };
  sdk: { name: string; version: string };
}

/** What was thrown → type, message and stack, whatever its shape (Error, string, a Supabase error object). */
export function describeError(error: unknown): { type: string; value: string; stack?: string } {
  if (error instanceof Error) {
    return { type: error.name || 'Error', value: error.message || String(error), stack: error.stack };
  }
  if (typeof error === 'string') return { type: 'Error', value: error };
  if (error && typeof error === 'object') {
    const e = error as { name?: unknown; message?: unknown; code?: unknown; details?: unknown; stack?: unknown };
    const parts = [e.code, e.message, e.details].filter((p) => typeof p === 'string' && p !== '');
    return {
      type: typeof e.name === 'string' && e.name ? e.name : 'Error',
      value: parts.length ? parts.join(' · ') : safeJson(error),
      stack: typeof e.stack === 'string' ? e.stack : undefined,
    };
  }
  return { type: 'Error', value: String(error) };
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** A short, comparable signature of an error, to send the same one only once per page. */
export function errorSignature(error: unknown): string {
  const d = describeError(error);
  const top = parseStack(d.stack).at(-1);
  return `${d.type}|${d.value.slice(0, 200)}|${top?.filename ?? ''}:${top?.lineno ?? ''}`;
}

function cleanExtra(extra: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(extra)) {
    out[key] = typeof value === 'string' ? scrubText(value).slice(0, 2000) : value;
  }
  return out;
}

export function buildEvent(error: unknown, base: EventBase, ctx: EventContext = {}, now = Date.now()): SentryEvent {
  const d = describeError(error);
  const frames = parseStack(d.stack);
  const event: SentryEvent = {
    event_id: randomHex(16),
    timestamp: now / 1000,
    platform: 'javascript',
    level: ctx.level ?? 'error',
    environment: base.environment,
    tags: { ...base.tags, ...ctx.tags },
    exception: {
      values: [{ type: d.type, value: scrubText(d.value).slice(0, 1000), ...(frames.length ? { stacktrace: { frames } } : {}) }],
    },
    sdk: { name: 'service-hub.monitor', version: '1.0.0' },
  };
  if (base.release) event.release = base.release;
  if (ctx.extra && Object.keys(ctx.extra).length) event.extra = cleanExtra(ctx.extra);
  if (ctx.user) event.user = ctx.user.role ? { id: ctx.user.id, role: ctx.user.role } : { id: ctx.user.id };
  if (ctx.url || ctx.userAgent) {
    event.request = {};
    if (ctx.url) event.request.url = scrubUrl(ctx.url);
    if (ctx.userAgent) event.request.headers = { 'User-Agent': ctx.userAgent };
  }
  if (ctx.breadcrumbs?.length) {
    event.breadcrumbs = { values: ctx.breadcrumbs.map((b) => ({ ...b, message: scrubText(b.message) })) };
  }
  if (ctx.fingerprint) event.fingerprint = ctx.fingerprint;
  return event;
}

/** The request body: envelope header, item header, the event (newline-delimited JSON). */
export function buildEnvelope(event: SentryEvent, dsn: SentryDsn, now = Date.now()): string {
  const header = { event_id: event.event_id, sent_at: new Date(now).toISOString(), dsn: dsn.dsn };
  return `${JSON.stringify(header)}\n${JSON.stringify({ type: 'event' })}\n${JSON.stringify(event)}\n`;
}

/**
 * Sends one event. Plain text body, so the browser sends it without a CORS preflight. Never
 * throws: a report that cannot be sent is dropped.
 */
export async function sendEvent(
  event: SentryEvent,
  dsn: SentryDsn,
  fetcher: typeof fetch = fetch,
  options: { keepalive?: boolean; timeoutMs?: number } = {},
): Promise<boolean> {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), options.timeoutMs ?? 5000) : null;
  try {
    const res = await fetcher(dsn.envelopeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: buildEnvelope(event, dsn),
      keepalive: options.keepalive,
      signal: controller?.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
