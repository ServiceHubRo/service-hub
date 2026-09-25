import { describe, expect, it } from 'vitest';
import { EMAIL_EVENTS, emailForEvent } from '../../supabase/functions/_shared/emails.ts';
import * as serverFormat from '../../supabase/functions/_shared/format.ts';
import {
  EVENTS,
  renderNotification,
  TEMPLATES,
  urlFor,
  type NotificationEvent,
} from '../../supabase/functions/_shared/templates.ts';
import * as appFormat from '../../src/i18n/format';

const booking = {
  booking_id: 'b-1',
  ref: 'P-000123',
  shop_id: 's-1',
  shop_name: 'Atelier Unu',
  client_name: 'Ana Marin',
  service_id: 'ulei',
  date: '2026-10-14',
  slot: '10:00',
  make: 'Volkswagen',
  model: 'Golf 7',
  plate: 'BV 12 ABC',
};

function ev(event: string, role: 'client' | 'shop', lang: 'ro' | 'en', params: Record<string, unknown> = {}): NotificationEvent {
  return {
    event,
    role,
    lang,
    params: { ...booking, ...params },
    booking_id: 'b-1',
    service: { ro: 'Schimb ulei și filtru', en: 'Oil & oil filter change' },
  };
}

// 2026-10-13 09:00 in Bucharest (UTC+3).
const NOW = new Date('2026-10-13T06:00:00Z');

/** Parameters that make every variant of every event render fully. */
const SAMPLE: Record<string, Record<string, unknown>> = {
  booking_declined: { reason: 'Nu avem piesa' },
  booking_cancelled_shop: { reason: 'Mecanic bolnav' },
  booking_cancelled_admin: { reason: 'Cont suspendat' },
  booking_rescheduled: { old_date: '2026-10-12', old_slot: '09:00' },
  quote_sent: { total: 1250, expires_at: '2026-10-16T11:00:00Z' },
  quote_replaced: { total: 990.5, expires_at: '2026-10-16T11:00:00Z' },
  quote_expiring: { total: 1250, expires_at: '2026-10-14T11:00:00Z' },
  quote_expired: { total: 1250 },
  quote_accepted: { total: 430, total_sent: 430 },
  quote_partially_accepted: { total: 430, total_sent: 610 },
  quote_refused: { inspection_fee: 100 },
  job_done: { cost: 1250, odometer: 105400 },
  appointment_reminder: { day: 'tomorrow' },
  new_message: { thread_id: 't-1', sender_name: 'Atelier Unu', preview: 'Mașina e gata.' },
  review_reply: { review_id: 'r-1' },
  new_review: { review_id: 'r-1', rating: 5 },
  doc_expiry: { car_id: 'c-1', doc: 'itp', days: 12, expiry: '2026-10-25' },
  daily_digest: { date: '2026-10-13', today: 4, pending: 2, first_slot: '08:30' },
  trial_ending: { days: 7, expiry: '2026-10-20', price: 100 },
  payment_failed: { total: 100, final: false, expiry: '2026-10-16' },
  shop_inactive: { reason: 'trial_ended' },
  review_report_decided: { review_id: 'r-1', rating: 1, decision: 'removed' },
};

const render = (event: string, role: 'client' | 'shop', lang: 'ro' | 'en', extra: Record<string, unknown> = {}) =>
  renderNotification(ev(event, role, lang, { ...SAMPLE[event], ...extra }), {}, NOW);

describe('notification texts', () => {
  it('RO and US English have the same texts with the same placeholders', () => {
    const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    expect(Object.keys(TEMPLATES.en).sort()).toEqual(Object.keys(TEMPLATES.ro).sort());
    for (const key of Object.keys(TEMPLATES.ro)) {
      const ro = TEMPLATES.ro[key]!;
      const en = TEMPLATES.en[key]!;
      expect(placeholders(en.title + en.body), key).toEqual(placeholders(ro.title + ro.body));
    }
  });

  it('every event a migration sends has a text for the side that receives it', () => {
    const files = import.meta.glob('../../supabase/migrations/*.sql', { query: '?raw', import: 'default', eager: true });
    const sql = (Object.values(files) as string[]).join('\n');
    const sent = (fn: string) => new Set([...sql.matchAll(new RegExp(`${fn}\\([^,]+,\\s*'(\\w+)'`, 'g'))].map((m) => m[1]!));
    // decide_quote passes its event in a variable.
    const toShop = new Set([...sent('notify_shop'), 'quote_accepted', 'quote_partially_accepted', 'quote_refused']);
    // The subscription's events go to the shop's owner (T14).
    const toOwner = sent('notify_shop_owner');
    expect(toOwner.size).toBeGreaterThan(3);
    for (const event of toOwner) {
      if (EMAIL_EVENTS.includes(event)) expect(emailForEvent({ event, lang: 'ro', params: {} }, 'https://x'), event).not.toBeNull();
      else expect(EVENTS.shop, event).toContain(event);
    }
    const toClient = sent('notify_user');
    expect(toShop.size).toBeGreaterThan(5);
    expect(toClient.size).toBeGreaterThan(10);
    for (const event of toShop) expect(EVENTS.shop, event).toContain(event);
    for (const event of toClient) {
      // Email-only events (T13) have an email instead of a push text.
      if (EMAIL_EVENTS.includes(event)) expect(emailForEvent({ event, lang: 'ro', params: {} }, 'https://x'), event).not.toBeNull();
      else expect(EVENTS.client, event).toContain(event);
    }
  });

  it('renders every event on both sides in both languages without leftovers', () => {
    for (const role of ['client', 'shop'] as const) {
      for (const event of EVENTS[role]) {
        for (const lang of ['ro', 'en'] as const) {
          const r = render(event, role, lang);
          expect(r, `${role}.${event}.${lang}`).not.toBeNull();
          expect(`${r!.title} ${r!.body}`, `${role}.${event}.${lang}`).not.toMatch(/[{}]|undefined|null|NaN/);
          expect(r!.body.length).toBeGreaterThan(5);
          expect(r!.url).toMatch(/^\/[cs]\//);
          if (lang === 'en') expect(r!.body).not.toMatch(/cancelled|tyre|colour|licence/i);
        }
      }
    }
  });

  it('writes what the client needs to know, in their language', () => {
    expect(render('quote_sent', 'client', 'ro')).toMatchObject({
      title: 'Atelier Unu',
      body: 'Devizul pentru Volkswagen Golf 7 e gata: 1.250 lei. Răspunde până pe 16 oct, ora 14:00.',
      url: '/c/programari?p=b-1',
      tag: 'booking-b-1',
    });
    expect(render('quote_sent', 'client', 'en')!.body).toBe(
      'The quote for your Volkswagen Golf 7 is ready: 1,250 RON. Please answer by Oct 16, 14:00.',
    );
    expect(render('booking_confirmed', 'client', 'ro')!.body).toBe('Programarea P-000123 e confirmată: Mie 14 oct, 10:00.');
    expect(render('booking_confirmed', 'client', 'en')!.body).toBe('Your booking P-000123 is confirmed: Wed, Oct 14, 10:00.');
    expect(render('job_done', 'client', 'ro')!.body).toBe('Volkswagen Golf 7 e gata de ridicare. Total: 1.250 lei.');
    expect(render('quote_expiring', 'client', 'ro')!.body).toBe(
      'Devizul pentru Volkswagen Golf 7 expiră mâine la 14:00. Răspunde ca să-ți păstrezi locul.',
    );
    expect(render('quote_expiring', 'client', 'en', { expires_at: '2026-10-13T18:00:00Z' })!.body).toBe(
      'The quote for your Volkswagen Golf 7 expires today at 21:00. Answer to keep your slot.',
    );
    expect(render('appointment_reminder', 'client', 'ro')!.body).toBe('Mâine la 10:00 ai programare la Atelier Unu: Schimb ulei și filtru.');
    expect(render('appointment_reminder', 'client', 'ro', { day: 'today' })!.body).toBe(
      'Azi la 10:00 ai programare la Atelier Unu: Schimb ulei și filtru.',
    );
    expect(render('booking_declined', 'client', 'en', { reason: '' })!.body).toBe("The shop can't take booking P-000123 on Wed, Oct 14, 10:00.");
    expect(render('new_message', 'client', 'ro')).toMatchObject({ title: 'Atelier Unu', body: 'Mașina e gata.', url: '/c/mesaje/t-1', tag: 'thread-t-1' });
  });

  it('document reminders name the document, the car and the time left', () => {
    expect(render('doc_expiry', 'client', 'ro')).toMatchObject({
      title: 'Volkswagen Golf 7',
      body: 'ITP-ul expiră în 12 zile, pe 25 oct.',
      url: '/c/garaj/c-1',
      tag: 'car-c-1-itp',
    });
    expect(render('doc_expiry', 'client', 'ro', { doc: 'rca', days: 1 })!.body).toBe('RCA-ul expiră în 1 zi, pe 25 oct.');
    expect(render('doc_expiry', 'client', 'ro', { doc: 'vignette', days: 0 })!.body).toBe('Rovinieta expiră azi.');
    expect(render('doc_expiry', 'client', 'ro', { days: -3 })!.body).toBe('ITP-ul a expirat pe 25 oct.');
    expect(render('doc_expiry', 'client', 'en', { doc: 'vignette', days: 30 })!.body).toBe('The road vignette expires in 30 days, on Oct 25.');
    expect(render('doc_expiry', 'client', 'ro', { days: 20 })!.body).toBe('ITP-ul expiră în 20 de zile, pe 25 oct.');
  });

  it('tells the shop who, what and when', () => {
    expect(render('booking_requested', 'shop', 'ro')).toMatchObject({
      title: 'Cerere nouă',
      body: 'Ana Marin: Schimb ulei și filtru, Mie 14 oct, 10:00. Volkswagen Golf 7 (BV 12 ABC).',
      url: '/s/programari?tab=cereri&p=b-1',
    });
    expect(render('quote_refused', 'shop', 'ro')!.body).toBe(
      'Ana Marin a refuzat devizul pentru Volkswagen Golf 7 (BV 12 ABC). Taxa de constatare: 100 lei.',
    );
    expect(render('quote_refused', 'shop', 'en', { inspection_fee: 0 })!.body).toBe(
      'Ana Marin declined the quote for the Volkswagen Golf 7 (BV 12 ABC).',
    );
    expect(render('quote_partially_accepted', 'shop', 'ro')!.body).toBe(
      'Ana Marin a acceptat 430 lei din 610 lei pentru Volkswagen Golf 7 (BV 12 ABC).',
    );
    expect(render('quote_expired', 'shop', 'ro')!.url).toBe('/s/istoric?q=P-000123');
    expect(render('booking_cancelled_client', 'shop', 'en')!.body).toBe('Ana Marin canceled booking P-000123 on Wed, Oct 14, 10:00.');
    expect(render('new_review', 'shop', 'ro')).toMatchObject({ body: 'Ana Marin ți-a dat 5 din 5 stele.', url: '/s/cont/recenzii' });
  });

  it('tells both sides how a reported review was decided (T16a)', () => {
    expect(render('review_report_decided', 'shop', 'ro')).toMatchObject({
      title: 'Recenzia raportată a fost ștearsă',
      body: 'Am șters recenzia pentru P-000123 (1 din 5 stele). Nu mai apare și nu mai contează la medie.',
      url: '/s/cont/recenzii',
      tag: 'review-r-1',
    });
    expect(render('review_report_decided', 'shop', 'en', { decision: 'kept' })!.title).toBe('The review stays up');
    expect(render('review_report_decided', 'client', 'ro')).toMatchObject({
      body: 'Echipa Service-Hub a șters recenzia ta pentru Atelier Unu (P-000123), pentru că nu respectă regulile platformei.',
      url: '/c/programari?p=b-1',
    });
    expect(render('shop_inactive', 'shop', 'ro', { reason: 'admin' })!.body).toBe(
      'Echipa Service-Hub a oprit abonamentul. Scrie-ne dacă ai întrebări. Datele tale rămân.',
    );
  });

  it('the daily summary counts in both languages', () => {
    expect(render('daily_digest', 'shop', 'ro')).toMatchObject({
      title: 'Programul de azi',
      body: 'Azi ai 4 programări, prima la 08:30. 2 cereri noi așteaptă răspuns.',
      url: '/s/panou',
    });
    expect(render('daily_digest', 'shop', 'ro', { today: 1, pending: 1 })!.body).toBe(
      'Azi ai o programare, la 08:30. O cerere nouă așteaptă răspuns.',
    );
    expect(render('daily_digest', 'shop', 'ro', { today: 21, pending: 0 })!.body).toBe('Azi ai 21 de programări, prima la 08:30.');
    expect(render('daily_digest', 'shop', 'en', { today: 0, pending: 1 })!.body).toBe('1 new request is waiting for an answer.');
    expect(render('daily_digest', 'shop', 'en')!.body).toBe(
      'You have 4 bookings today, the first at 08:30. 2 new requests are waiting for an answer.',
    );
  });

  it('uses the admin overrides for one language only', () => {
    const e = ev('job_done', 'client', 'ro', SAMPLE.job_done);
    const r = renderNotification(e, { 'client.job_done': { ro: { body: 'Gata: {car}, {cost}.' } } }, NOW)!;
    expect(r.body).toBe('Gata: Volkswagen Golf 7, 1.250 lei.');
    expect(r.title).toBe('Atelier Unu');
    expect(renderNotification({ ...e, lang: 'en' }, { 'client.job_done': { ro: { body: 'Gata' } } }, NOW)!.body).toBe(
      'Your Volkswagen Golf 7 is ready for pickup. Total: 1,250 RON.',
    );
  });

  it('has nothing for admins or for events a side never gets', () => {
    expect(renderNotification(ev('booking_confirmed', 'shop', 'ro'), {}, NOW)).toBeNull();
    expect(renderNotification({ ...ev('booking_confirmed', 'client', 'ro'), role: 'admin' }, {}, NOW)).toBeNull();
    expect(renderNotification(ev('broadcast', 'client', 'ro'), {}, NOW)).toBeNull();
  });

  it('opens the right screen', () => {
    expect(urlFor('client', ev('review_reply', 'client', 'ro'))).toBe('/c/programari?p=b-1');
    expect(urlFor('shop', ev('quote_accepted', 'shop', 'ro'))).toBe('/s/programari?p=b-1');
    expect(urlFor('shop', { ...ev('new_message', 'shop', 'ro', { thread_id: 't-9' }), booking_id: null })).toBe('/s/mesaje/t-9');
  });
});

describe('server formatting matches the app', () => {
  it.each(['ro', 'en'] as const)('%s', (lang) => {
    for (const amount of [0, 80, 99.5, 1250, 1250.75, 104300]) {
      expect(serverFormat.formatMoney(lang, amount)).toBe(appFormat.formatMoney(lang, amount));
    }
    expect(serverFormat.formatKm(lang, 105400)).toBe(appFormat.formatKm(lang, 105400));
    for (const ymd of ['2026-01-05', '2026-03-29', '2026-10-14', '2026-12-31']) {
      expect(serverFormat.formatDate(lang, ymd)).toBe(appFormat.formatDate(lang, ymd));
    }
    const instant = new Date('2026-10-25T00:30:00Z'); // the night the clocks go back
    expect(serverFormat.formatTime(lang, instant)).toBe(appFormat.formatTime(lang, instant));
    expect(serverFormat.ymdInBucharest(instant)).toBe(appFormat.ymdInBucharest(instant));
  });
});
