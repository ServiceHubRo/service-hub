import { useEffect, useRef } from 'react';
import { useI18n } from '../i18n/context';
import styles from './Captcha.module.css';

/**
 * Cloudflare Turnstile, only when VITE_TURNSTILE_SITE_KEY is set (ARCHITECTURE §6). When Supabase
 * Auth has CAPTCHA turned on it asks for a token on sign-up, sign-in, password reset and resend,
 * so every one of those forms carries this widget. Tokens are single-use: reset after each try.
 */
import { SITE_KEY } from './captchaConfig';

interface Turnstile {
  render: (el: HTMLElement, options: Record<string, unknown>) => string;
  remove: (id: string) => void;
}
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

let scriptPromise: Promise<void> | null = null;
function loadScript(): Promise<void> {
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error('turnstile'));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export function CaptchaWidget({ onToken }: { onToken: (token: string | null) => void }) {
  const { lang } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const tokenRef = useRef(onToken);
  useEffect(() => {
    tokenRef.current = onToken;
  }, [onToken]);

  useEffect(() => {
    let id: string | null = null;
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !ref.current || !window.turnstile) return;
        id = window.turnstile.render(ref.current, {
          sitekey: SITE_KEY,
          theme: 'dark',
          language: lang,
          callback: (token: string) => tokenRef.current(token),
          'expired-callback': () => tokenRef.current(null),
          'error-callback': () => tokenRef.current(null),
        });
      })
      .catch(() => tokenRef.current(null));
    return () => {
      cancelled = true;
      if (id && window.turnstile) window.turnstile.remove(id);
    };
  }, [lang]);

  return <div ref={ref} className={styles.widget} />;
}

