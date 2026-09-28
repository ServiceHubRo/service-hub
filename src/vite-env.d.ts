/// <reference types="vite/client" />

declare const __APP_CONTEXT__: string;
declare const __APP_RELEASE__: string;

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Cloudflare Turnstile site key (public). CAPTCHA is shown only when it is set. */
  readonly VITE_TURNSTILE_SITE_KEY?: string;
  /** Sentry project address (public). Error reports are sent only when it is set (T19). */
  readonly VITE_SENTRY_DSN?: string;
  /** The published site, for links the phone app hands to others (T20). Defaults to the Netlify site. */
  readonly VITE_WEB_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
