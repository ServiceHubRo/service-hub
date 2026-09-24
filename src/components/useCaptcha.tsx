import { useCallback, useState, type ReactNode } from 'react';
import { CaptchaWidget } from './Captcha';
import { CAPTCHA_ENABLED } from './captchaConfig';

export interface CaptchaState {
  /** The widget to place above the submit button (null when CAPTCHA is off). */
  element: ReactNode;
  /** The token to send; undefined when CAPTCHA is off. */
  token: string | undefined;
  /** False while CAPTCHA is on and not solved yet. */
  ready: boolean;
  /** After every attempt: the token was used up. */
  reset: () => void;
}

export function useCaptcha(): CaptchaState {
  const [token, setToken] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const reset = useCallback(() => {
    setToken(null);
    setGeneration((g) => g + 1);
  }, []);
  if (!CAPTCHA_ENABLED) return { element: null, token: undefined, ready: true, reset: () => undefined };
  return {
    element: <CaptchaWidget key={generation} onToken={setToken} />,
    token: token ?? undefined,
    ready: token !== null,
    reset,
  };
}
