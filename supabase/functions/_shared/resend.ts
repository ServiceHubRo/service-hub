// App emails through the Resend API (ARCHITECTURE §9). Plain fetch, no npm package.
// Secrets: RESEND_API_KEY (required to send), EMAIL_FROM (optional sender), RESEND_API_URL
// (optional; only the local browser tests point it at a stand-in).
//
// An idempotency key makes Resend send a message once even if we ask twice (e.g. the database
// did not hear that the first attempt went through); Resend keeps the keys for 24 hours.

export const DEFAULT_FROM = 'Service-Hub <notificari@service-hub.ro>';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  idempotencyKey?: string;
}

/** sent · retry (try again later) · failed (will not work) · not_configured (no key). */
export interface SendOutcome {
  outcome: 'sent' | 'retry' | 'failed' | 'not_configured';
  error?: string;
}

export interface EmailConfig {
  apiKey?: string;
  from?: string;
  url?: string;
  fetch?: typeof fetch;
}

const looksLikeAddress = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);

export async function sendEmail(message: EmailMessage, config: EmailConfig): Promise<SendOutcome> {
  if (!config.apiKey) return { outcome: 'not_configured' };
  if (!looksLikeAddress(message.to)) return { outcome: 'failed', error: 'bad_address' };
  const doFetch = config.fetch ?? fetch;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
  };
  if (message.idempotencyKey) headers['Idempotency-Key'] = message.idempotencyKey.slice(0, 256);
  let res: Response;
  try {
    res = await doFetch(`${(config.url ?? 'https://api.resend.com').replace(/\/+$/, '')}/emails`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        from: config.from ?? DEFAULT_FROM,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(message.replyTo && looksLikeAddress(message.replyTo) ? { reply_to: message.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    return { outcome: 'retry', error: `email network: ${e instanceof Error ? e.message : 'error'}`.slice(0, 300) };
  }
  if (res.ok) {
    await res.body?.cancel();
    return { outcome: 'sent' };
  }
  const detail = (await res.text().catch(() => '')).slice(0, 200);
  // Too many requests or a problem on their side: later. Anything else (bad address, domain not
  // verified, wrong key) will not get better by itself.
  const retry = res.status === 429 || res.status >= 500;
  return { outcome: retry ? 'retry' : 'failed', error: `email ${res.status} ${detail}`.trim() };
}
