// CORS of the Edge Functions (SEC-04, audit 13 Nov 2026): only the app's own addresses may read an
// answer. Pure, so the unit tests import it without Deno; `serve` in http.ts applies it.

import { OWN_ORIGINS } from './app.ts';

/**
 * The headers every answer to the app carries. `Access-Control-Allow-Origin` is not among them: `serve`
 * adds it per request, only for an address of ours (SEC-04, audit 13 Nov 2026), so a page on another
 * site cannot read an answer even with a token it got hold of.
 */
export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/**
 * Where the app runs and may call the functions from: service-hub.ro, the Netlify site and its deploy
 * previews, local development and the browser tests (app.ts), plus the Android app, whose pages are
 * served by Capacitor from https://localhost. The address in APP_URL counts too.
 */
const CORS_ONLY = [/^https:\/\/localhost$/];

export function allowedOrigin(origin: string | null | undefined, appUrl?: string): string | null {
  const o = (origin ?? '').trim();
  if (!o) return null;
  if (appUrl && o === appUrl.trim().replace(/\/+$/, '')) return o;
  return [...OWN_ORIGINS, ...CORS_ONLY].some((re) => re.test(o)) ? o : null;
}

/** The response with `Access-Control-Allow-Origin` set for an allowed origin and removed otherwise. */
export function withCors(res: Response, origin: string | null): Response {
  const headers = new Headers(res.headers);
  headers.delete('Access-Control-Allow-Origin');
  if (origin) headers.set('Access-Control-Allow-Origin', origin);
  const vary = headers.get('Vary');
  if (!vary) headers.set('Vary', 'Origin');
  else if (!/\borigin\b/i.test(vary)) headers.set('Vary', `${vary}, Origin`);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
