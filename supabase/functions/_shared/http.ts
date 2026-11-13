// Shared HTTP helpers for the Edge Functions: CORS for the browser app and JSON responses.

import { allowedOrigin, corsHeaders, withCors } from './cors.ts';

export { corsHeaders };

/** `Deno.serve` for the functions the app calls: every answer gets the CORS origin of `allowedOrigin`. */
export function serve(handler: (req: Request) => Response | Promise<Response>): void {
  Deno.serve(async (req) => {
    const origin = allowedOrigin(req.headers.get('Origin'), Deno.env.get('APP_URL'));
    return withCors(await handler(req), origin);
  });
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** The bearer token of the request, or null. */
export function bearerToken(req: Request): string | null {
  const header = req.headers.get('Authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1]!.trim() : null;
}
