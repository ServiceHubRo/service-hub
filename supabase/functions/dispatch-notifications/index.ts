// dispatch-notifications — sends the outbox (ARCHITECTURE §9, §11).
//
// GET  → the VAPID public key the browser subscribes with. The first call ever makes the key pair
//        and stores it (push_config), together with this function's own address, so the database
//        can wake it: no manual setup. The "Deploy Supabase" Action calls it once after deploying.
// POST → called by the database (pg_net) after every new outbox event and by the one-minute
//        sweep, with the x-dispatch-token header from push_config. Claims due events, renders
//        each in the recipient's language, sends it to every device of the recipient, and records
//        the result: dead devices (404/410) are deleted, failures are retried a few times.
//
// Each channel (push, email, sms — T13) is finished on its own: a retry only repeats the
// channels that did not get through, so an SMS or an email is never sent twice. Emails go
// through Resend (RESEND_API_KEY) with the event id as idempotency key; platform events (a
// reported review) go to ADMIN_EMAIL. SMS go through SMSO (SMSO_API_KEY), only to a verified
// phone. A channel without its secret is logged `not_configured`.
import { adminApi } from '../_shared/admin.ts';
import { emailForEvent } from '../_shared/emails.ts';
import { corsHeaders, json } from '../_shared/http.ts';
import { adminEmailFromEnv, appUrlFromEnv, emailConfigFromEnv, smsConfigFromEnv } from '../_shared/env.ts';
import { sendEmail, type EmailConfig, type SendOutcome } from '../_shared/resend.ts';
import { smsForEvent } from '../_shared/sms.ts';
import { sendSms, type SmsConfig } from '../_shared/smso.ts';
import { renderNotification, type NotificationEvent, type Overrides } from '../_shared/templates.ts';
import { generateVapidKeys, sendWebPush, type PushDevice, type VapidKeys } from '../_shared/webpush.ts';

const SUBJECT = 'https://service-hub.ro';
const BATCH = 50;
const TIME_BUDGET_MS = 20_000;
const MAX_ATTEMPTS = 5;

type Api = ReturnType<typeof adminApi>;

interface Config {
  vapid_public_key: string | null;
  vapid_private_jwk: JsonWebKey | null;
  dispatch_url: string | null;
  dispatch_token: string;
}

interface ClaimedEvent extends NotificationEvent {
  id: string;
  /** null for platform events (to ADMIN_EMAIL). */
  user_id: string | null;
  channels: string[];
  attempts: number;
  email: string | null;
  phone: string | null;
  devices: { endpoint: string; keys: { p256dh?: string; auth?: string } | null }[];
}

/** What the channels other than push need, read once per call. */
interface Senders {
  email: EmailConfig;
  sms: SmsConfig;
  adminEmail: string | null;
  app: string;
}

interface LogEntry {
  channel: string;
  status: string;
  error?: string;
}

interface Result {
  id: string;
  done: boolean;
  error: string | null;
  channels_done: string[];
  log: LogEntry[];
  gone: string[];
  delivered: string[];
}

const CONFIG_QUERY = 'push_config?id=eq.1&select=vapid_public_key,vapid_private_jwk,dispatch_url,dispatch_token';

async function readConfig(api: Api): Promise<Config> {
  const rows = (await api.select(CONFIG_QUERY)) as unknown as Config[];
  if (!rows[0]) throw new Error('push_config row missing');
  return rows[0];
}

/** Makes the VAPID keys on first use and records this function's address for the database. */
async function ensureSetup(api: Api): Promise<Config> {
  let config = await readConfig(api);
  if (!config.vapid_public_key || !config.vapid_private_jwk) {
    const keys = await generateVapidKeys();
    // Only if still empty: two first calls at once must not end up with two different keys.
    await api.update('push_config?id=eq.1&vapid_public_key=is.null', {
      vapid_public_key: keys.publicKey,
      vapid_private_jwk: keys.privateJwk,
    });
    config = await readConfig(api);
  }
  const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/dispatch-notifications`;
  if (config.dispatch_url !== url) {
    await api.update('push_config?id=eq.1', { dispatch_url: url });
    config = { ...config, dispatch_url: url };
  }
  return config;
}

function sameToken(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const URGENT = new Set(['booking_requested', 'quote_sent', 'job_done', 'new_message', 'quote_expiring']);
const QUIET = new Set(['daily_digest', 'doc_expiry']);

/** How long a push service keeps it for a device that is offline. */
function ttlFor(event: string): number {
  if (event === 'daily_digest') return 4 * 3600;
  if (event === 'appointment_reminder' || event === 'quote_expiring') return 12 * 3600;
  return 24 * 3600;
}

/** One channel's result: finished (logged) or to try again later. */
type ChannelResult = { done: true; log: LogEntry } | { done: false; error: string };

async function pushChannel(e: ClaimedEvent, texts: Overrides, vapid: VapidKeys, result: Result): Promise<ChannelResult> {
  const rendered = renderNotification(e, texts);
  if (!rendered) return { done: true, log: { channel: 'push', status: 'no_template' } };
  if (e.devices.length === 0) return { done: true, log: { channel: 'push', status: 'no_device' } };
  const payload = JSON.stringify({ title: rendered.title, body: rendered.body, url: rendered.url, tag: rendered.tag });
  const outcomes = await Promise.all(
    e.devices.map(async (d) => {
      if (!d.keys?.p256dh || !d.keys.auth) return { endpoint: d.endpoint, outcome: 'failed' as const, error: 'no_keys' };
      const r = await sendWebPush(d as PushDevice, payload, vapid, SUBJECT, {
        ttl: ttlFor(e.event),
        urgency: URGENT.has(e.event) ? 'high' : QUIET.has(e.event) ? 'low' : 'normal',
      });
      return { endpoint: d.endpoint, outcome: r.outcome, error: r.error };
    }),
  );
  const sent = outcomes.filter((o) => o.outcome === 'sent');
  const retry = outcomes.filter((o) => o.outcome === 'retry');
  result.delivered.push(...sent.map((o) => o.endpoint));
  result.gone.push(...outcomes.filter((o) => o.outcome === 'gone').map((o) => o.endpoint));
  const errors = outcomes.filter((o) => o.error).map((o) => o.error);
  // Retry only when nothing arrived anywhere: a device that already got it must not get it twice.
  if (sent.length === 0 && retry.length > 0 && e.attempts < MAX_ATTEMPTS) {
    return { done: false, error: (retry[0]?.error ?? 'retry').slice(0, 500) };
  }
  const status = sent.length === outcomes.length ? 'sent' : sent.length > 0 ? 'partial' : 'failed';
  return { done: true, log: { channel: 'push', status, error: errors.length ? errors.join(' | ').slice(0, 500) : undefined } };
}

/** A sender's answer as a channel result: `retry` waits for another round while attempts remain. */
function fromOutcome(channel: string, e: ClaimedEvent, r: SendOutcome): ChannelResult {
  if (r.outcome === 'retry' && e.attempts < MAX_ATTEMPTS) return { done: false, error: r.error ?? `${channel} retry` };
  const status = r.outcome === 'retry' ? 'failed' : r.outcome;
  return { done: true, log: { channel, status, error: r.error?.slice(0, 500) } };
}

async function emailChannel(e: ClaimedEvent, senders: Senders): Promise<ChannelResult> {
  const platform = e.user_id === null;
  const to = platform ? senders.adminEmail : e.email;
  if (!senders.email.apiKey || (platform && !to)) return { done: true, log: { channel: 'email', status: 'not_configured' } };
  if (!to) return { done: true, log: { channel: 'email', status: 'no_address' } };
  const content = emailForEvent(e, senders.app);
  if (!content) return { done: true, log: { channel: 'email', status: 'no_template' } };
  const r = await sendEmail(
    { to, ...content, replyTo: senders.adminEmail ?? undefined, idempotencyKey: `notification-${e.id}` },
    senders.email,
  );
  return fromOutcome('email', e, r);
}

async function smsChannel(e: ClaimedEvent, senders: Senders): Promise<ChannelResult> {
  if (!senders.sms.apiKey) return { done: true, log: { channel: 'sms', status: 'not_configured' } };
  if (!e.phone) return { done: true, log: { channel: 'sms', status: 'no_phone' } };
  const text = smsForEvent(e);
  if (!text) return { done: true, log: { channel: 'sms', status: 'no_template' } };
  return fromOutcome('sms', e, await sendSms(e.phone, text, senders.sms));
}

async function deliver(e: ClaimedEvent, texts: Overrides, vapid: VapidKeys, senders: Senders): Promise<Result> {
  const result: Result = { id: e.id, done: true, error: null, channels_done: [], log: [], gone: [], delivered: [] };
  const errors: string[] = [];
  const outcomes = await Promise.all(
    e.channels.map(async (channel): Promise<[string, ChannelResult]> => {
      switch (channel) {
        case 'push':
          return [channel, await pushChannel(e, texts, vapid, result)];
        case 'email':
          return [channel, await emailChannel(e, senders)];
        case 'sms':
          return [channel, await smsChannel(e, senders)];
        default:
          return [channel, { done: true, log: { channel, status: 'unknown_channel' } }];
      }
    }),
  );
  for (const [channel, r] of outcomes) {
    if (r.done) {
      result.channels_done.push(channel);
      result.log.push(r.log);
    } else {
      result.done = false;
      errors.push(r.error);
    }
  }
  result.error = errors.length ? errors.join(' | ').slice(0, 500) : null;
  return result;
}

async function dispatch(api: Api, config: Config): Promise<number> {
  const vapid: VapidKeys = { publicKey: config.vapid_public_key!, privateJwk: config.vapid_private_jwk! };
  const senders: Senders = {
    email: emailConfigFromEnv(),
    sms: smsConfigFromEnv(),
    adminEmail: adminEmailFromEnv(),
    app: appUrlFromEnv(),
  };
  const started = Date.now();
  let processed = 0;
  while (Date.now() - started < TIME_BUDGET_MS) {
    const claim = (await api.rpc('claim_notifications', { p_limit: BATCH })) as { events: ClaimedEvent[]; texts: Overrides };
    const events = claim?.events ?? [];
    if (events.length === 0) break;
    const results = await Promise.all(
      events.map((e) =>
        deliver(e, claim.texts ?? {}, vapid, senders).catch(
          (err): Result => ({
            id: e.id,
            done: e.attempts >= MAX_ATTEMPTS,
            error: err instanceof Error ? err.message.slice(0, 500) : 'error',
            channels_done: [],
            log: [],
            gone: [],
            delivered: [],
          }),
        ),
      ),
    );
    await api.rpc('finish_notifications', { p_results: results });
    processed += events.length;
    if (events.length < BATCH) break;
  }
  return processed;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { ...corsHeaders, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' } });
  }
  try {
    const api = adminApi();
    if (req.method === 'GET') {
      const config = await ensureSetup(api);
      return json({ publicKey: config.vapid_public_key });
    }
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

    const config = await ensureSetup(api);
    const token = req.headers.get('x-dispatch-token') ?? '';
    if (!sameToken(token, config.dispatch_token)) return json({ error: 'not_allowed' }, 403);
    const processed = await dispatch(api, config);
    return json({ processed });
  } catch (e) {
    console.error('dispatch-notifications', e);
    return json({ error: 'server_error' }, 500);
  }
});
