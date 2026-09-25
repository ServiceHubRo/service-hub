// email-logo — the wordmark at the top of every email, as a PNG (ARCHITECTURE §9). Public, no
// sign-in: email programs fetch it. An image because the Gmail app on iPhone repaints the colors
// of text in dark mode, never those of images. Drawn by scripts/gen-email-logo.mjs.
import { LOGO_PNG_BASE64 } from '../_shared/emailLogo.ts';

const png = Uint8Array.from(atob(LOGO_PNG_BASE64), (c) => c.charCodeAt(0));

Deno.serve(
  () =>
    new Response(png, {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=604800', 'Access-Control-Allow-Origin': '*' },
    }),
);
