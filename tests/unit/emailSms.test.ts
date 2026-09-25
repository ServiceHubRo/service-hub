import { describe, expect, it } from 'vitest';
import { appUrl, DEFAULT_APP_URL, linkBase } from '../../supabase/functions/_shared/app.ts';
import {
  AUTH_EMAIL_KINDS,
  authEmailHtml,
  authEmailSubject,
  authEmailSubjects,
} from '../../supabase/functions/_shared/authEmails.ts';
import { emailForEvent, escapeHtml, staffInviteEmail } from '../../supabase/functions/_shared/emails.ts';
import { sendEmail } from '../../supabase/functions/_shared/resend.ts';
import { codeSms, SMS_MAX, smsForEvent } from '../../supabase/functions/_shared/sms.ts';
import { resetSmsSenderCache, sendSms, smsSafe, toE164 } from '../../supabase/functions/_shared/smso.ts';
import type { NotificationEvent } from '../../supabase/functions/_shared/templates.ts';

type Call = { url: string; init: RequestInit };
function fakeFetch(...answers: Response[]) {
  const calls: Call[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = answers.shift();
    if (!next) throw new TypeError('network down');
    return next;
  }) as typeof fetch;
  return { fn, calls };
}
const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('Resend', () => {
  const message = { to: 'ana@example.com', subject: 'S', html: '<p>h</p>', text: 't', idempotencyKey: 'notification-1', replyTo: 'admin@example.com' };

  it('sends with the key, the sender, both parts and the idempotency key', async () => {
    const f = fakeFetch(jsonResponse(200, { id: 'x' }));
    expect(await sendEmail(message, { apiKey: 're_1', fetch: f.fn })).toEqual({ outcome: 'sent' });
    const call = f.calls[0]!;
    expect(call.url).toBe('https://api.resend.com/emails');
    const headers = call.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer re_1');
    expect(headers['Idempotency-Key']).toBe('notification-1');
    expect(JSON.parse(String(call.init.body))).toEqual({
      from: 'Service-Hub <notificari@service-hub.ro>',
      to: ['ana@example.com'],
      subject: 'S',
      html: '<p>h</p>',
      text: 't',
      reply_to: 'admin@example.com',
    });
  });

  it('knows what is worth retrying', async () => {
    expect((await sendEmail(message, { apiKey: 'k', fetch: fakeFetch(jsonResponse(429, {})).fn })).outcome).toBe('retry');
    expect((await sendEmail(message, { apiKey: 'k', fetch: fakeFetch(jsonResponse(503, {})).fn })).outcome).toBe('retry');
    expect((await sendEmail(message, { apiKey: 'k', fetch: fakeFetch().fn })).outcome).toBe('retry');
    const refused = await sendEmail(message, { apiKey: 'k', fetch: fakeFetch(jsonResponse(422, { message: 'domain not verified' })).fn });
    expect(refused.outcome).toBe('failed');
    expect(refused.error).toContain('domain not verified');
  });

  it('does nothing without a key or an address', async () => {
    const f = fakeFetch();
    expect(await sendEmail(message, { fetch: f.fn })).toEqual({ outcome: 'not_configured' });
    expect((await sendEmail({ ...message, to: 'nope' }, { apiKey: 'k', fetch: f.fn })).outcome).toBe('failed');
    expect(f.calls).toHaveLength(0);
  });
});

describe('SMSO', () => {
  it('normalizes Romanian numbers', () => {
    expect(toE164('0723 375 248')).toBe('+40723375248');
    expect(toE164('+40 723-375-248')).toBe('+40723375248');
    expect(toE164('0040723375248')).toBe('+40723375248');
    expect(toE164('40723375248')).toBe('+40723375248');
    expect(toE164('0268 312 445')).toBe('+40268312445');
    expect(toE164('12345')).toBeNull();
    expect(toE164('+44 20 7946 0958')).toBeNull();
    expect(toE164(null)).toBeNull();
  });

  it('writes without diacritics', () => {
    expect(smsSafe('Frână, șină, ţeavă, „Îți” – gata…')).toBe('Frana, sina, teava, "Iti" - gata...');
  });

  it('sends a form with the sender and the key', async () => {
    const f = fakeFetch(jsonResponse(200, { status: 200, responseToken: 't' }));
    expect(await sendSms('0723375248', 'Codul: 123456', { apiKey: 'k', sender: '4', fetch: f.fn })).toEqual({ outcome: 'sent' });
    expect(f.calls[0]!.url).toBe('https://app.smso.ro/api/v1/send');
    expect((f.calls[0]!.init.headers as Record<string, string>)['X-Authorization']).toBe('k');
    expect(Object.fromEntries(new URLSearchParams(String(f.calls[0]!.init.body)))).toEqual({
      to: '+40723375248',
      sender: '4',
      body: 'Codul: 123456',
    });
  });

  it('uses the account’s first sender when none is set', async () => {
    resetSmsSenderCache();
    const f = fakeFetch(jsonResponse(200, [{ id: 7, name: 'SMSO' }]), jsonResponse(200, { status: 200 }));
    expect((await sendSms('0723375248', 'x', { apiKey: 'k', fetch: f.fn })).outcome).toBe('sent');
    expect(f.calls[0]!.url).toBe('https://app.smso.ro/api/v1/senders');
    expect(new URLSearchParams(String(f.calls[1]!.init.body)).get('sender')).toBe('7');
    resetSmsSenderCache();
  });

  it('reports failures', async () => {
    expect((await sendSms('0723375248', 'x', { apiKey: 'k', sender: '1', fetch: fakeFetch(jsonResponse(200, { status: 402 })).fn })).outcome).toBe('failed');
    expect((await sendSms('0723375248', 'x', { apiKey: 'k', sender: '1', fetch: fakeFetch(jsonResponse(502, {})).fn })).outcome).toBe('retry');
    expect((await sendSms('0723375248', 'x', { apiKey: 'k', sender: '1', fetch: fakeFetch().fn })).outcome).toBe('retry');
    expect((await sendSms('07', 'x', { apiKey: 'k', sender: '1' })).outcome).toBe('failed');
    expect(await sendSms('0723375248', 'x', {})).toEqual({ outcome: 'not_configured' });
  });
});

describe('SMS texts', () => {
  const request = (lang: 'ro' | 'en', params: Record<string, unknown> = {}, service = { ro: 'Schimb ulei + filtru ulei', en: 'Oil & oil filter change' }): NotificationEvent => ({
    event: 'booking_requested',
    role: 'shop',
    lang,
    booking_id: 'b',
    params: { client_name: 'Maria Pop', date: '2026-10-14', slot: '10:00', ...params },
    service,
  });

  it('a new request, in the shop’s language, with the way to stop them', () => {
    expect(smsForEvent(request('ro'))).toBe(
      'Service-Hub: cerere noua de la Maria Pop, Mie 14 oct, 10:00: Schimb ulei + filtru ulei. Raspunde in aplicatie. Oprire SMS: Setari > Notificari',
    );
    expect(smsForEvent(request('en'))).toBe(
      'Service-Hub: new request from Maria Pop, Wed, Oct 14, 10:00: Oil & oil filter change. Reply in the app. Stop SMS: Settings > Notifications',
    );
  });

  it('always fits one message', () => {
    const long = request('ro', { client_name: 'Ștefănescu-Țăranu Alexandra-Mădălina Georgiana' }, {
      ro: 'Diagnoză computerizată completă a sistemului de injecție și a turbosuflantei',
      en: 'x',
    });
    const text = smsForEvent(long)!;
    expect(text.length).toBeLessThanOrEqual(SMS_MAX);
    expect(text).toMatch(/^Service-Hub: cerere noua de la Stefanescu/);
    expect(text).toMatch(/Oprire SMS: Setari > Notificari$/);
    expect(/^[\x20-\x7E]*$/.test(text)).toBe(true);
  });

  it('only for new requests to shops', () => {
    expect(smsForEvent({ ...request('ro'), event: 'quote_sent' })).toBeNull();
    expect(smsForEvent({ ...request('ro'), role: 'client' })).toBeNull();
  });

  it('the code message', () => {
    expect(codeSms('ro', '482913')).toBe('Codul tau Service-Hub: 482913. Expira in 10 minute. Nu il da nimanui.');
    expect(codeSms('en', '482913')).toContain('Your Service-Hub code: 482913.');
    expect(codeSms('ro', '482913').length).toBeLessThanOrEqual(SMS_MAX);
  });
});

describe('app emails', () => {
  it('the staff invitation, in both languages, with the link and escaped names', () => {
    const d = { shop: 'Atelier <Unu>', city: 'Brașov', inviter: 'Ion Popescu', email: 'vlad@example.com', url: 'https://service-hub-app.netlify.app/invitatie/abc' };
    const ro = staffInviteEmail('ro', d);
    expect(ro.subject).toBe('Ion Popescu te invită în Atelier <Unu> pe Service-Hub');
    expect(ro.html).toContain('Atelier &lt;Unu&gt; (Brașov)');
    expect(ro.html).not.toContain('<Unu>');
    expect(ro.html).toContain('href="https://service-hub-app.netlify.app/invitatie/abc"');
    expect(ro.html).toContain('<html lang="ro">');
    expect(ro.text).toContain('Acceptă invitația: https://service-hub-app.netlify.app/invitatie/abc');
    expect(ro.text).toContain('vlad@example.com');
    const en = staffInviteEmail('en', d);
    expect(en.subject).toBe('Ion Popescu invited you to Atelier <Unu> on Service-Hub');
    expect(en.html).toContain('Accept the invitation');
  });

  it('a reported review goes to the admin in Romanian, with everything needed to decide', () => {
    const mail = emailForEvent(
      {
        event: 'review_reported',
        lang: 'ro',
        params: { shop_name: 'Atelier Unu', shop_city: 'Brașov', shop_display_id: 'S-00001', client_name: 'Ana M.', rating: 1,
          text: 'Nu recomand <b>deloc</b>', reason: 'abusive', ref: 'P-000123', reported_at: '2026-10-14T08:30:00Z' },
      },
      'https://service-hub-app.netlify.app',
    )!;
    expect(mail.subject).toBe('Recenzie raportată: Atelier Unu (1★)');
    expect(mail.text).toContain('Motiv: Limbaj abuziv');
    expect(mail.text).toContain('Service: Atelier Unu · Brașov · S-00001');
    expect(mail.text).toContain('Raportată: Mie 14 oct, 11:30');
    expect(mail.text).toContain('> Nu recomand <b>deloc</b>');
    expect(mail.html).toContain('Nu recomand &lt;b&gt;deloc&lt;/b&gt;');
    expect(mail.text).toContain('5 zile lucrătoare');
  });

  it('suspension, account or shop, in the recipient’s language', () => {
    expect(emailForEvent({ event: 'account_suspended', lang: 'ro', params: { kind: 'account' } }, '')!.subject).toBe(
      'Contul tău Service-Hub e suspendat',
    );
    expect(emailForEvent({ event: 'account_suspended', lang: 'en', params: { kind: 'shop', shop_name: 'Atelier Unu' } }, '')!.subject).toBe(
      'Your shop Atelier Unu is suspended',
    );
    expect(emailForEvent({ event: 'quote_sent', lang: 'ro', params: {} }, '')).toBeNull();
  });

  it('escapes HTML', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});

describe('links in emails', () => {
  it('point to the app, or to the preview the owner uses when it is ours', () => {
    expect(appUrl(undefined)).toBe(DEFAULT_APP_URL);
    expect(appUrl('https://service-hub.ro/')).toBe('https://service-hub.ro');
    expect(appUrl('not a url')).toBe(DEFAULT_APP_URL);
    const app = 'https://service-hub.ro';
    expect(linkBase('https://deploy-preview-14--service-hub-app.netlify.app', app)).toBe('https://deploy-preview-14--service-hub-app.netlify.app');
    expect(linkBase('https://service-hub-app.netlify.app/', app)).toBe('https://service-hub-app.netlify.app');
    expect(linkBase('https://www.service-hub.ro', app)).toBe('https://www.service-hub.ro');
    expect(linkBase('http://localhost:4173', app)).toBe('http://localhost:4173');
    expect(linkBase('https://evil.example.com', app)).toBe(app);
    expect(linkBase('https://service-hub-app.netlify.app.evil.com', app)).toBe(app);
    expect(linkBase('https://x--other.netlify.app', app)).toBe(app);
    expect(linkBase(null, app)).toBe(app);
  });
});

const templateFiles = import.meta.glob('../../supabase/templates/*', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>;
const readTemplate = (name: string) => templateFiles[`../../supabase/templates/${name}`] ?? '';
const configToml = Object.values(
  import.meta.glob('../../supabase/config.toml', { query: '?raw', import: 'default', eager: true }) as Record<string, string>,
)[0]!;

describe('Auth email templates', () => {
  it('the files in supabase/templates are up to date (node scripts/build-auth-templates.mjs)', () => {
    const subjects = JSON.parse(readTemplate('subjects.json')) as Record<string, string>;
    for (const kind of AUTH_EMAIL_KINDS) {
      expect(readTemplate(`${kind}.html`)).toBe(authEmailHtml(kind));
      expect(subjects[kind]).toBe(authEmailSubject(kind));
    }
  });

  it('the local stack uses the same subjects and files', () => {
    const toml = configToml;
    for (const kind of AUTH_EMAIL_KINDS) {
      expect(toml).toContain(`[auth.email.template.${kind}]\nsubject = '${authEmailSubject(kind)}'\ncontent_path = "./supabase/templates/${kind}.html"`);
    }
  });

  it('each template has both languages, the link and the Go placeholders', () => {
    for (const kind of AUTH_EMAIL_KINDS) {
      const html = authEmailHtml(kind);
      expect(html.startsWith('{{ if eq (printf "%v" .Data.lang) "en" }}<!doctype html>')).toBe(true);
      expect(html).toContain('<html lang="en">');
      expect(html).toContain('<html lang="ro">');
      expect(html.match(/href="\{\{ \.ConfirmationURL \}\}"/g)).toHaveLength(4);
      expect(html).toContain('{{ .Email }}');
      expect(html.trimEnd().endsWith('{{ end }}')).toBe(true);
      const subjects = authEmailSubjects(kind);
      expect(authEmailSubject(kind)).toBe(`{{ if eq (printf "%v" .Data.lang) "en" }}${subjects.en}{{ else }}${subjects.ro}{{ end }}`);
    }
    expect(authEmailHtml('email_change')).toContain('{{ .NewEmail }}');
    // The subjects the browser tests look for.
    expect(authEmailSubjects('confirmation').ro).toMatch(/confirm/i);
    expect(authEmailSubjects('recovery').ro).toMatch(/reset/i);
    expect(authEmailSubjects('email_change').ro).toMatch(/email/i);
  });
});
