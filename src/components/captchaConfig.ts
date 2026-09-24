/** Cloudflare Turnstile site key (public). CAPTCHA is on only when it is set. */
export const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY ?? '';
export const CAPTCHA_ENABLED = SITE_KEY !== '';
