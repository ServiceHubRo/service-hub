import http from 'node:http';
import { expect } from '@playwright/test';

/**
 * Stand-ins for Resend (email) and SMSO (SMS) for the browser tests (T13). The local stack's
 * Edge Functions send to them (supabase/config.toml → [edge_runtime.secrets] points at
 * host.docker.internal:54398); the server runs once for the whole test run (global-setup.ts) and
 * the tests read what arrived through GET /_log.
 */
export const PROVIDERS_PORT = 54398;
const LOG_URL = `http://127.0.0.1:${PROVIDERS_PORT}/_log`;

export interface SentEmail {
  kind: 'email';
  to: string;
  subject: string;
  html: string;
  text: string;
  reply_to?: string;
  idempotencyKey?: string;
}

export interface SentSms {
  kind: 'sms';
  to: string;
  sender: string;
  body: string;
}

type Sent = SentEmail | SentSms;

export function startProviders(): Promise<() => Promise<void>> {
  const log: Sent[] = [];
  const seenKeys = new Set<string>();
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const reply = (status: number, data: unknown) => {
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(data));
      };
      const url = req.url ?? '';
      if (req.method === 'GET' && url === '/_log') return reply(200, log);
      if (req.method === 'POST' && url === '/resend/emails') {
        if (req.headers.authorization !== 'Bearer local-test-key') return reply(401, { message: 'bad key' });
        const m = JSON.parse(body) as { to: string[]; subject: string; html: string; text: string; reply_to?: string };
        const key = String(req.headers['idempotency-key'] ?? '');
        // Like Resend: the same idempotency key sends once.
        if (key && seenKeys.has(key)) return reply(200, { id: 'duplicate' });
        if (key) seenKeys.add(key);
        log.push({ kind: 'email', to: m.to[0]!, subject: m.subject, html: m.html, text: m.text, reply_to: m.reply_to, idempotencyKey: key });
        return reply(200, { id: crypto.randomUUID() });
      }
      if (req.method === 'POST' && url === '/smso/send') {
        if (req.headers['x-authorization'] !== 'local-test-key') return reply(401, { status: 401 });
        const form = new URLSearchParams(body);
        log.push({ kind: 'sms', to: form.get('to') ?? '', sender: form.get('sender') ?? '', body: form.get('body') ?? '' });
        return reply(200, { status: 200, responseToken: crypto.randomUUID(), transaction_cost: 0.05 });
      }
      reply(404, { message: 'not found' });
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PROVIDERS_PORT, '0.0.0.0', () =>
      resolve(() => new Promise<void>((done) => server.close(() => done()))),
    );
  });
}

async function readLog(): Promise<Sent[]> {
  return (await (await fetch(LOG_URL)).json()) as Sent[];
}

/** Every email sent to an address so far. */
export async function emailsTo(to: string): Promise<SentEmail[]> {
  return (await readLog()).filter((m): m is SentEmail => m.kind === 'email' && m.to.toLowerCase() === to.toLowerCase());
}

/** The newest email to an address, waiting for it. */
export async function nextEmail(to: string, after = 0): Promise<SentEmail> {
  await expect.poll(async () => (await emailsTo(to)).length, { timeout: 20_000 }).toBeGreaterThan(after);
  const list = await emailsTo(to);
  return list[list.length - 1]!;
}

/** Every SMS sent to a number (`+40…`) so far. */
export async function smsTo(to: string): Promise<SentSms[]> {
  return (await readLog()).filter((m): m is SentSms => m.kind === 'sms' && m.to === to);
}

/** The newest SMS to a number, waiting for it. */
export async function nextSms(to: string, after = 0): Promise<SentSms> {
  await expect.poll(async () => (await smsTo(to)).length, { timeout: 20_000 }).toBeGreaterThan(after);
  const list = await smsTo(to);
  return list[list.length - 1]!;
}
