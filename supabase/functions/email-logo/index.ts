// email-logo — the pictures in every email (ARCHITECTURE §9): the wordmark at the top, and with
// `?b=<name>` a button (its text drawn on the amber). Public, no sign-in: email programs fetch
// them. Images because the Gmail app on iPhone repaints the colors of text and buttons in dark
// mode, never those of images. Drawn by scripts/gen-email-logo.mjs and scripts/gen-email-buttons.mjs.
import { EMAIL_BUTTON_PNG_BASE64 } from '../_shared/emailButtonImages.ts';
import { LOGO_PNG_BASE64 } from '../_shared/emailLogo.ts';

const decode = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const logo = decode(LOGO_PNG_BASE64);
const buttons = new Map(Object.entries(EMAIL_BUTTON_PNG_BASE64).map(([name, b64]) => [name, decode(b64)]));

Deno.serve((req) => {
  const name = new URL(req.url).searchParams.get('b');
  // An unknown button name gets the wordmark rather than an error (a broken image in an email).
  const png = (name && buttons.get(name)) || logo;
  return new Response(png, {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=604800', 'Access-Control-Allow-Origin': '*' },
  });
});
