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
  new_message: { thread_id: 't-1', sender_name: 'Atelier Unu', preview: 'Mașina este gata.' },
  review_reply: { review_id: 'r-1' },
  new_review: { review_id: 'r-1', rating: 5 },
  doc_expiry: { car_id: 'c-1', doc: 'itp', days: 12, expiry: '2026-10-25' },
  daily_digest: { date: '2026-10-13', today: 4, pending: 2, first_slot: '08:30' },
  trial_ending: { days: 7, expiry: '2026-10-20', price: 100 },
  payment_failed: { total: 100, final: false, expiry: '2026-10-16' },
  shop_inactive: { reason: 'trial_ended' },
  review_report_decided: { review_id: 'r-1', rating: 1, decision: 'removed' },
  review_request: {},
  service_due: { car_id: 'c-1', service_id: 'lichid_frana', last_done: '2024-10-20', due: '2026-10-20' },
  referral_reward: { kind: 'trial_days', referral_shop_id: 's-9', referred_name: 'Auto Nou', days: 30, expiry: '2026-11-20' },
  referral_revoked: { kind: 'trial_days', referral_shop_id: 's-9', referred_name: 'Auto Nou', reason: 'refunded' },
  tire_season: { season: 'winter', car_id: 'c-1' },
  welcome: { day: 3, has_car: false },
  area_launched: { area: 'CJ', area_ro: 'Cluj', area_en: 'Cluj', shops: 3 },
  favorite_offer: { percent: 15 },
  booking_request_waiting: {},
  booking_request_last_call: {},
  monthly_report: { month: '2026-09', requests: 14, done: 9, revenue: 6450, new_clients: 5, reviews: 3, rating: 4.7 },
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

  it('a referral reward says which shop paid and what the owner got', () => {
    expect(render('referral_reward', 'shop', 'ro')).toMatchObject({
      title: 'Ai primit o lună gratuită',
      body: 'Auto Nou, service-ul recomandat de tine, a plătit abonamentul. Perioada ta gratuită s-a prelungit cu 30 de zile, până pe 20 nov.',
      url: '/s/cont/abonament',
      tag: 'referral-s-9',
    });
    expect(render('referral_reward', 'shop', 'en', { kind: 'stripe_credit', total: 149 })!.body).toBe(
      'Auto Nou, the shop you referred, paid its subscription. Your next payment is 149 RON lower.',
    );
    const mail = emailForEvent({ event: 'referral_reward', lang: 'ro', params: { ...SAMPLE.referral_reward, kind: 'stripe_credit', total: 149 } }, 'https://x');
    expect(mail!.subject).toBe('Ai primit o lună gratuită');
    expect(mail!.text).toContain('Următoarea ta plată este mai mică cu 149 lei');
    expect(render('referral_revoked', 'shop', 'ro')).toMatchObject({ title: 'Luna gratuită s-a anulat', tag: 'referral-s-9' });
    const revoked = emailForEvent({ event: 'referral_revoked', lang: 'en', params: { ...SAMPLE.referral_revoked, reason: 'disputed' } }, 'https://x');
    expect(revoked!.text).toContain('Auto Nou disputed its first payment at the bank.');
  });

  it('suspension and reactivation reach the phone too, account or shop', () => {
    expect(render('account_suspended', 'client', 'ro', { kind: 'account' })).toMatchObject({ title: 'Cont suspendat', url: '/c/cauta', tag: 'account' });
    expect(render('account_reactivated', 'client', 'en', { kind: 'account' })!.body).toBe(
      'Your Service-Hub account is active again. You can book as before.',
    );
    expect(render('account_suspended', 'shop', 'ro', { kind: 'shop', shop_name: 'Atelier Unu' })).toMatchObject({
      title: 'Service suspendat',
      url: '/s/panou',
    });
    expect(render('account_reactivated', 'shop', 'ro', { kind: 'shop', shop_name: 'Atelier Unu' })!.body).toBe(
      'Atelier Unu este din nou activ: apare în căutări și poate primi programări.',
    );
  });

  it('writes what the client needs to know, in their language', () => {
    expect(render('quote_sent', 'client', 'ro')).toMatchObject({
      title: 'Atelier Unu',
      body: 'Devizul pentru Volkswagen Golf 7 este gata: 1.250 lei. Răspunde până pe 16 oct, ora 14:00.',
      url: '/c/programari?p=b-1',
      tag: 'booking-b-1',
    });
    expect(render('quote_sent', 'client', 'en')!.body).toBe(
      'The quote for your Volkswagen Golf 7 is ready: 1,250 RON. Please answer by Oct 16, 14:00.',
    );
    expect(render('booking_confirmed', 'client', 'ro')!.body).toBe('Programarea P-000123 este confirmată: Mie 14 oct, 10:00.');
    expect(render('booking_confirmed', 'client', 'en')!.body).toBe('Your booking P-000123 is confirmed: Wed, Oct 14, 10:00.');
    expect(render('job_done', 'client', 'ro')!.body).toBe('Volkswagen Golf 7 este gata de ridicare. Total: 1.250 lei.');
    expect(render('quote_expiring', 'client', 'ro')!.body).toBe(
      'Devizul pentru Volkswagen Golf 7 expiră mâine la 14:00. Răspunde ca să-ți păstrezi locul.',
    );
    expect(render('quote_expiring', 'client', 'en', { expires_at: '2026-10-13T18:00:00Z' })!.body).toBe(
      'The quote for your Volkswagen Golf 7 expires today at 21:00. Answer to keep your slot.',
    );
    expect(render('appointment_reminder', 'client', 'ro')!.body).toBe('Mâine la 10:00 ai programare la Atelier Unu: Schimb ulei și filtru.');
    expect(render('appointment_reminder', 'client', 'ro', { date: '2026-10-13' })!.body).toBe(
      'Azi la 10:00 ai programare la Atelier Unu: Schimb ulei și filtru.',
    );
    // Sent the evening before and held by the quiet hours (T24): the day is the one on the phone.
    expect(render('appointment_reminder', 'client', 'ro', { day: 'tomorrow', date: '2026-10-13' })!.body).toMatch(/^Azi/);
    expect(render('appointment_reminder', 'client', 'en', { date: '', day: 'today' })!.body).toMatch(/today/);
    expect(render('booking_declined', 'client', 'en', { reason: '' })!.body).toBe("The shop can't take booking P-000123 on Wed, Oct 14, 10:00.");
    expect(render('new_message', 'client', 'ro')).toMatchObject({ title: 'Atelier Unu', body: 'Mașina este gata.', url: '/c/mesaje/t-1', tag: 'thread-t-1' });
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

  it('tips and offers (T24): tires, welcome, a favorite shop, and where a tap leads', () => {
    expect(render('tire_season', 'client', 'ro', { make: '', model: '', shop_id: '', shop_name: '' })).toMatchObject({
      title: 'Anvelopele de iarnă',
      body: 'Este momentul pentru anvelopele de iarnă la mașina ta. Programează schimbul din aplicație, înainte de aglomerație.',
      url: '/c/cauta?cat=cat_anv',
      tag: 'tire_season',
    });
    expect(render('tire_season', 'client', 'en', { season: 'summer', shop_id: 's-1' })).toMatchObject({
      title: 'Summer tires',
      body: 'Time for summer tires on your Volkswagen Golf 7. Last time you had them changed at Atelier Unu; you can book in the app.',
      url: '/c/service/s-1',
    });
    expect(render('welcome', 'client', 'ro')).toMatchObject({ url: '/c/cauta' });
    expect(render('welcome', 'client', 'ro', { day: 14 })).toMatchObject({ title: 'Adaugă mașina în Garaj', url: '/c/garaj' });
    expect(render('welcome', 'client', 'en', { day: 14, has_car: true })!.body).toBe(
      'When your car needs a shop, compare the reviews and book in the app. It takes a minute.',
    );
    expect(render('area_launched', 'client', 'ro')).toMatchObject({
      title: 'Service-Hub a ajuns și la tine',
      body: 'De azi te poți programa online la service-urile din județul Cluj. Caută unul aproape de tine.',
      url: '/c/cauta',
      tag: 'area_launched',
    });
    expect(render('area_launched', 'client', 'en', { area: 'B', area_ro: 'București', area_en: 'Bucharest' })!.body).toBe(
      'Starting today you can book shops in Bucharest online. Find one near you.',
    );
    expect(render('favorite_offer', 'client', 'ro')).toMatchObject({
      title: 'Atelier Unu',
      body: 'Atelier Unu îți oferă 15% reducere la manoperă la prima programare.',
      url: '/c/service/s-1',
      tag: 'offer-s-1',
    });
  });

  it('to the shop (T24): a request still waiting, and the month before', () => {
    expect(render('booking_request_waiting', 'shop', 'ro')).toMatchObject({
      title: 'O cerere așteaptă răspunsul tău',
      body: 'Ana Marin așteaptă răspuns pentru Mie 14 oct, 10:00: Schimb ulei și filtru. Confirmă programarea sau propune altă oră.',
      url: '/s/programari?tab=cereri&p=b-1',
    });
    expect(render('booking_request_last_call', 'shop', 'ro')).toMatchObject({
      title: 'Ultima reamintire pentru o cerere',
      body: 'Ana Marin așteaptă încă răspuns pentru Mie 14 oct, 10:00: Schimb ulei și filtru. Dacă nu răspunzi până atunci, cererea se închide automat. Confirmă programarea sau propune altă oră.',
      url: '/s/programari?tab=cereri&p=b-1',
    });
    expect(render('booking_request_last_call', 'shop', 'en')!.title).toBe('Last reminder for a request');
    expect(render('monthly_report', 'shop', 'ro')).toMatchObject({
      title: 'Luna septembrie pe Service-Hub',
      body: 'Lucrări finalizate: 9. Încasări: 6.450 lei. Cereri primite: 14. Vezi raportul complet.',
      url: '/s/cont/rapoarte',
      tag: 'monthly-2026-09',
    });
    expect(render('monthly_report', 'shop', 'en')!.title).toBe('Your September on Service-Hub');
    const mail = emailForEvent({ event: 'monthly_report', lang: 'ro', params: { ...SAMPLE.monthly_report, shop_name: 'Atelier Unu' } }, 'https://x');
    expect(mail!.subject).toBe('Atelier Unu: luna septembrie pe Service-Hub');
    expect(mail!.text).toContain('6.450 lei');
    expect(mail!.text).toContain('3 (media 4,7)');
    expect(mail!.html).toContain('https://x/s/cont/rapoarte');
    const en = emailForEvent({ event: 'monthly_report', lang: 'en', params: { ...SAMPLE.monthly_report, reviews: 0 } }, 'https://x');
    expect(en!.text).toContain('6,450 RON');
    expect(en!.text).toContain('Settings → Notifications');
  });

  it('asks for a review of the job, and opens the form on the booking', () => {
    expect(render('review_request', 'client', 'ro')).toMatchObject({
      title: 'Atelier Unu',
      body: 'Cum a fost la Atelier Unu? Lasă o recenzie pentru Schimb ulei și filtru. Durează un minut și îi ajută pe alți șoferi.',
      url: '/c/programari?p=b-1&recenzie=1',
      tag: 'review-request-b-1',
    });
    expect(render('review_request', 'client', 'en')!.body).toBe(
      'How was it at Atelier Unu? Leave a review for Oil & oil filter change. It takes a minute and helps other drivers.',
    );
  });

  it('reminds the next service and opens the booking at the same shop, the service and the car chosen', () => {
    expect(render('service_due', 'client', 'ro')).toMatchObject({
      title: 'Volkswagen Golf 7: Schimb ulei și filtru',
      body: 'Ultima dată pe 20 oct 2024, la Atelier Unu. Următoarea este recomandată în jurul datei de 20 oct. Programează-te din aplicație.',
      url: '/c/service/s-1/programare?pas=2&serviciu=lichid_frana&masina=c-1',
      tag: 'service-due-c-1-lichid_frana',
    });
    expect(render('service_due', 'client', 'en')!.body).toBe(
      'Last done on Oct 20, 2024 at Atelier Unu. The next one is coming up, around Oct 20. Book it in the app.',
    );
  });

  it('tells the shop who, what and when', () => {
    expect(render('booking_requested', 'shop', 'ro')).toMatchObject({
      title: 'Cerere nouă',
      body: 'Ana Marin: Schimb ulei și filtru, Mie 14 oct, 10:00. Volkswagen Golf 7 (BV 12 ABC).',
      url: '/s/programari?tab=cereri&p=b-1',
    });
    // Several services in one booking (T21): the first one and how many more.
    expect(render('booking_requested', 'shop', 'ro', { extra_count: 2 })!.body).toBe(
      'Ana Marin: Schimb ulei și filtru și încă 2, Mie 14 oct, 10:00. Volkswagen Golf 7 (BV 12 ABC).',
    );
    expect(render('booking_requested', 'shop', 'en', { extra_count: 1 })!.body).toContain('Oil & oil filter change and 1 more');
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

  it('closes an unanswered request kindly, and points the client to other shops nearby', () => {
    const params = { shop_name: 'Atelier Unu', client_name: 'Ana Marin', category: 'cat_rev', city: 'Brașov' };
    expect(renderNotification(ev('request_expired', 'client', 'ro', params), {}, NOW)).toMatchObject({
      title: 'Cererea ta s-a închis',
      body: 'Ne pare rău, Atelier Unu nu a reușit să răspundă la timp pentru Mie 14 oct, 10:00. Îți arătăm acum alte service-uri din zonă care te pot ajuta.',
    });
    expect(renderNotification(ev('request_expired', 'client', 'en', params), {}, NOW)!.title).toBe('Your request has closed');
    expect(renderNotification(ev('request_expired', 'shop', 'ro', params), {}, NOW)!.body).toBe(
      'Cererea de la Ana Marin pentru Mie 14 oct, 10:00 (Schimb ulei și filtru) s-a închis automat, pentru că ora programării a trecut. Un răspuns rapid aduce mai mulți clienți în service.',
    );
    expect(urlFor('client', ev('request_expired', 'client', 'ro', params))).toBe('/c/cauta?cat=cat_rev&oras=Bra%C8%99ov');
    expect(urlFor('client', ev('request_expired', 'client', 'ro'))).toBe('/c/cauta');
    expect(urlFor('shop', ev('request_expired', 'shop', 'ro', params))).toBe('/s/programari?tab=cereri');
  });

  it('asks the shop how a past appointment went, and says when it closed on its own', () => {
    const params = { client_name: 'Ana Marin', ref: 'P-000123' };
    expect(renderNotification(ev('booking_followup', 'shop', 'ro', params), {}, NOW)).toMatchObject({
      title: 'Cum a decurs programarea?',
      body: 'Ana Marin avea programare Mie 14 oct, 10:00, pentru Volkswagen Golf 7 (BV 12 ABC). Spune-ne ce s-a întâmplat: dacă mașina a venit, apasă „În constatare”, iar dacă nu, „Neprezentat”.',
    });
    expect(renderNotification(ev('booking_auto_closed', 'shop', 'en', params), {}, NOW)!.body).toBe(
      'Booking P-000123 with Ana Marin on Wed, Oct 14, 10:00 closed automatically because it was not updated for 7 days. The customer was not marked as a no-show.',
    );
    expect(urlFor('shop', ev('booking_auto_closed', 'shop', 'ro', params))).toBe('/s/istoric?q=P-000123');
    expect(urlFor('shop', ev('booking_followup', 'shop', 'ro', params))).toBe('/s/programari?p=b-1');
    expect(renderNotification(ev('booking_followup', 'client', 'ro', params), {}, NOW)).toBeNull();
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
    for (const ymd of ['2024-10-20', '2026-01-05', '2026-03-29', '2026-10-14', '2026-12-31', '2027-02-01']) {
      expect(serverFormat.formatDayMonthYear(lang, ymd, NOW)).toBe(appFormat.formatDayMonth(lang, ymd, NOW));
      expect(serverFormat.formatDate(lang, ymd)).toBe(appFormat.formatDate(lang, ymd));
    }
    const instant = new Date('2026-10-25T00:30:00Z'); // the night the clocks go back
    expect(serverFormat.formatTime(lang, instant)).toBe(appFormat.formatTime(lang, instant));
    expect(serverFormat.ymdInBucharest(instant)).toBe(appFormat.ymdInBucharest(instant));
  });
});
