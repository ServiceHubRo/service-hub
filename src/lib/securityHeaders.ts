/**
 * The security headers of the published site (after T35, Eduard: "fă tot ce poți"). Netlify sends
 * them with every file (`dist/_headers`, written by the build: vite.config.ts), and `vite preview`
 * sends them too, so the browser tests run under the same rules.
 *
 * The Content-Security-Policy lists the only places the browser may load from: the site itself,
 * this build's Supabase project (API, Realtime, Storage pictures), the error reports (Sentry), the
 * map tiles and, when CAPTCHA is on, Cloudflare Turnstile. Everything else is refused, so a script
 * slipped into a page could not send data anywhere or load more code. The one inline script of
 * index.html (the start-up guard) is allowed by its hash. Pages of other sites may not show
 * Service-Hub inside a frame (clicks cannot be tricked).
 */

export interface SecurityHeaderInput {
  /** VITE_SUPABASE_URL of this build. */
  supabaseUrl?: string;
  /** VITE_SENTRY_DSN of this build. */
  sentryDsn?: string;
  /** VITE_MAP_TILE_URL of this build (`{z}/{x}/{y}` template); OpenStreetMap when unset. */
  mapTileUrl?: string;
  /** VITE_TURNSTILE_SITE_KEY of this build: CAPTCHA on. */
  turnstile?: boolean;
  /** `sha256-…` of each inline script in index.html. */
  scriptHashes: string[];
}

export const DEFAULT_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TURNSTILE = 'https://challenges.cloudflare.com';

/** `https://host[:port]` of an address, or null when it is not an http(s) address. */
export function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    // A tile template has `{z}` in it; the origin is before the path anyway.
    const url = new URL(value.replace(/[{}]/g, ''));
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null;
  } catch {
    return null;
  }
}

/** The WebSocket address Supabase Realtime uses for an API origin. */
function socketOf(origin: string): string {
  return origin.replace(/^http/, 'ws');
}

/** A tile template on several servers (`{s}.tile…`) is allowed for all of them. */
function tileSource(template: string): string | null {
  if (/^https?:\/\/\{s\}\./.test(template)) {
    const origin = originOf(template.replace('{s}.', 'a.'));
    return origin ? origin.replace('://a.', '://*.') : null;
  }
  return originOf(template);
}

/** The Content-Security-Policy header value. */
export function contentSecurityPolicy(input: SecurityHeaderInput): string {
  const supabase = originOf(input.supabaseUrl);
  const sentry = originOf(input.sentryDsn);
  const tiles = tileSource(input.mapTileUrl || DEFAULT_TILE_URL);
  const list = (...values: (string | null | false | undefined)[]) => values.filter(Boolean).join(' ');
  const directives: [string, string][] = [
    ['default-src', "'self'"],
    ['script-src', list("'self'", ...input.scriptHashes.map((h) => `'${h}'`), input.turnstile && TURNSTILE)],
    // Leaflet and React set styles through the DOM; some libraries add a <style>. Styles cannot
    // send data or run code.
    ['style-src', "'self' 'unsafe-inline'"],
    ['img-src', list("'self'", 'data:', 'blob:', supabase, tiles)],
    ['font-src', "'self' data:"],
    ['connect-src', list("'self'", supabase, supabase && socketOf(supabase), sentry)],
    ['frame-src', input.turnstile ? TURNSTILE : "'none'"],
    ['worker-src', "'self'"],
    ['manifest-src', "'self'"],
    ['media-src', "'self'"],
    ['object-src', "'none'"],
    ['base-uri', "'self'"],
    ['form-action', "'self'"],
    ['frame-ancestors', "'none'"],
  ];
  return directives.map(([name, value]) => `${name} ${value}`).join('; ');
}

/** Every header, in the order they are written. */
export function securityHeaders(input: SecurityHeaderInput): [string, string][] {
  return [
    ['Content-Security-Policy', contentSecurityPolicy(input)],
    // Always https for a year, subdomains included (no preload list: that is hard to undo).
    ['Strict-Transport-Security', 'max-age=31536000; includeSubDomains'],
    ['X-Frame-Options', 'DENY'],
    ['X-Content-Type-Options', 'nosniff'],
    ['Referrer-Policy', 'strict-origin-when-cross-origin'],
    // Only the location is used (Caută: "Aproape de tine"); nothing else the phone has.
    ['Permissions-Policy', 'geolocation=(self), camera=(), microphone=(), payment=(), usb=(), bluetooth=(), serial=(), interest-cohort=()'],
    ['Cross-Origin-Opener-Policy', 'same-origin'],
  ];
}

/** Netlify's `_headers` file: the headers for every path. */
export function headersFile(headers: [string, string][]): string {
  return ['/*', ...headers.map(([name, value]) => `  ${name}: ${value}`), ''].join('\n');
}

/** The headers back from a `_headers` file written by headersFile (for `vite preview`). */
export function parseHeadersFile(text: string): [string, string][] {
  return text
    .split('\n')
    .filter((line) => /^\s+[A-Za-z-]+:\s/.test(line))
    .map((line) => {
      const at = line.indexOf(':');
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()] as [string, string];
    });
}

/** The contents of every inline `<script>` (without `src`) in an HTML page. */
export function inlineScripts(html: string): string[] {
  const out: string[] = [];
  const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (/\ssrc\s*=/i.test(m[1] ?? '')) continue;
    out.push(m[2] ?? '');
  }
  return out;
}
