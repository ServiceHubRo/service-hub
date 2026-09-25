// SMS through SMSO (smso.ro), ARCHITECTURE §9. Plain fetch, no npm package.
// Secrets: SMSO_API_KEY (required to send), SMSO_SENDER (optional: the sender id from SMSO →
// Senders; without it the first sender of the account is used), SMSO_API_URL (optional; only
// the local browser tests point it at a stand-in).
//
// SMS texts are written without diacritics: with ș or ț a message holds 70 characters instead
// of 160 and costs up to twice as much.
import type { SendOutcome } from './resend.ts';

export interface SmsConfig {
  apiKey?: string;
  sender?: string;
  url?: string;
  fetch?: typeof fetch;
}

/** A Romanian number as SMSO wants it (`+40723375248`), or null when it is not one. */
export function toE164(phone: string | null | undefined): string | null {
  let digits = (phone ?? '').replace(/[\s\-.()/]/g, '');
  if (digits.startsWith('+40')) digits = digits.slice(3);
  else if (digits.startsWith('0040')) digits = digits.slice(4);
  else if (digits.startsWith('40') && digits.length === 11) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = digits.slice(1);
  else return null;
  return /^[237]\d{8}$/.test(digits) ? `+40${digits}` : null;
}

const PUNCTUATION: Record<string, string> = { '„': '"', '”': '"', '“': '"', '’': "'", '…': '...', '–': '-', '—': '-' };

/** Text an SMS can carry in its cheap alphabet: no diacritics, no typographic quotes. */
export function smsSafe(text: string): string {
  return text
    .replace(/[„”“’…–—]/g, (c) => PUNCTUATION[c] ?? c)
    // ă â î ș ț (comma or cedilla) decompose into the letter and a mark; the marks go.
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7E\n]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

let cachedSender: string | null = null;

async function senderId(config: SmsConfig, base: string, doFetch: typeof fetch): Promise<string | null> {
  if (config.sender) return config.sender;
  if (cachedSender) return cachedSender;
  const res = await doFetch(`${base}/senders`, {
    headers: { 'X-Authorization': config.apiKey! },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    await res.body?.cancel();
    return null;
  }
  const list = (await res.json().catch(() => null)) as { id?: number | string }[] | null;
  const first = Array.isArray(list) ? list.find((s) => s && (typeof s.id === 'number' || typeof s.id === 'string')) : null;
  cachedSender = first ? String(first.id) : null;
  return cachedSender;
}

/** Test hook: forget the sender learnt from SMSO. */
export function resetSmsSenderCache(): void {
  cachedSender = null;
}

export async function sendSms(to: string, text: string, config: SmsConfig): Promise<SendOutcome> {
  if (!config.apiKey) return { outcome: 'not_configured' };
  const phone = toE164(to);
  if (!phone) return { outcome: 'failed', error: 'bad_phone' };
  const doFetch = config.fetch ?? fetch;
  const base = (config.url ?? 'https://app.smso.ro/api/v1').replace(/\/+$/, '');
  try {
    const sender = await senderId(config, base, doFetch);
    if (!sender) return { outcome: 'failed', error: 'sms no sender' };
    const form = new URLSearchParams({ to: phone, sender, body: smsSafe(text) });
    const res = await doFetch(`${base}/send`, {
      method: 'POST',
      headers: { 'X-Authorization': config.apiKey, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.text().catch(() => '');
    let status = res.status;
    try {
      const parsed = JSON.parse(body) as { status?: number };
      if (typeof parsed.status === 'number') status = parsed.status;
    } catch {
      // not JSON: the HTTP status decides
    }
    if (res.ok && status >= 200 && status < 300) return { outcome: 'sent' };
    const retry = res.status === 429 || res.status >= 500;
    return { outcome: retry ? 'retry' : 'failed', error: `sms ${res.status} ${body.slice(0, 200)}`.trim() };
  } catch (e) {
    return { outcome: 'retry', error: `sms network: ${e instanceof Error ? e.message : 'error'}`.slice(0, 300) };
  }
}
