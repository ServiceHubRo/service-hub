/// <reference types="vite/client" />

declare const __APP_CONTEXT__: string;

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Cloudflare Turnstile site key (public). CAPTCHA is shown only when it is set. */
  readonly VITE_TURNSTILE_SITE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
