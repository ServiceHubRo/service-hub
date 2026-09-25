// Notification texts (ARCHITECTURE §9): event + parameters → title, body, the screen a tap opens,
// in the recipient's language (RO, US English) and from the recipient's side (client or shop).
// Texts can be overridden from platform_settings.notification_texts with the same keys:
//   { "client.quote_sent": { "ro": { "title": "…", "body": "…" }, "en": { … } } }
// Placeholders are the names in `vars()` below, e.g. {shop}, {car}, {total}, {when}.
import {
  daysBetween,
  formatDate,
  formatDayMonth,
  formatKm,
  formatMoney,
  formatTime,
  ymdInBucharest,
  type Lang,
} from './format.ts';

export type { Lang };
export type Side = 'client' | 'shop';

export interface Text {
  title: string;
  body: string;
}

export type Overrides = Record<string, Partial<Record<Lang, Partial<Text>>>>;

/** One claimed outbox row, as claim_notifications() answers it. */
export interface NotificationEvent {
  event: string;
  role: string;
  lang: string;
  params: Record<string, unknown>;
  booking_id: string | null;
  service?: { ro: string; en: string } | null;
}

export interface Rendered {
  key: string;
  title: string;
  body: string;
  /** The app path a tap opens. */
  url: string;
  /** Same tag = the newer notification replaces the older one on the device. */
  tag: string;
}

const BRAND = 'Service-Hub';

/** The owner's Abonament screen (T14): where every subscription notice and email leads. */
export const SUBSCRIPTION_PATH = '/s/cont/abonament';

/** The client's Rapoartele mele (T15): where a finished history report is downloaded. */
export const REPORTS_PATH = '/c/cont/rapoarte';

export const TEMPLATES: Record<Lang, Record<string, Text>> = {
  ro: {
    // ------------------------------------------------------------------ to the client
    'client.booking_confirmed': { title: '{shop}', body: 'Programarea {ref} e confirmată: {when}.' },
    'client.booking_declined': { title: '{shop}', body: 'Service-ul nu poate prelua programarea {ref} din {when}.' },
    'client.booking_declined_reason': {
      title: '{shop}',
      body: 'Service-ul nu poate prelua programarea {ref} din {when}. Motiv: {reason}',
    },
    'client.booking_rescheduled': { title: '{shop}', body: 'Programarea {ref} a fost mutată: {when}.' },
    'client.booking_cancelled_shop': {
      title: '{shop}',
      body: 'Service-ul a anulat programarea {ref} din {when}. Motiv: {reason}',
    },
    'client.booking_cancelled_admin': {
      title: BRAND,
      body: 'Programarea {ref} la {shop} a fost anulată de echipa Service-Hub. Motiv: {reason}',
    },
    'client.no_show': { title: '{shop}', body: 'Programarea {ref} din {when} a fost marcată ca neprezentare.' },
    'client.inspection_started': { title: '{shop}', body: '{car} e în constatare. Devizul vine în aplicație.' },
    'client.quote_sent': { title: '{shop}', body: 'Devizul pentru {car} e gata: {total}. Răspunde până pe {deadline}.' },
    'client.quote_replaced': { title: '{shop}', body: 'Service-ul a modificat devizul pentru {car}: {total}.' },
    'client.quote_withdrawn': { title: '{shop}', body: 'Service-ul a retras devizul pentru {car}.' },
    'client.quote_expiring': {
      title: '{shop}',
      body: 'Devizul pentru {car} expiră {deadline_rel}. Răspunde ca să-ți păstrezi locul.',
    },
    'client.quote_expired': { title: '{shop}', body: 'Devizul pentru {car} a expirat fără răspuns.' },
    'client.work_started': { title: '{shop}', body: 'Lucrarea la {car} a început.' },
    'client.job_done': { title: '{shop}', body: '{car} e gata de ridicare. Total: {cost}.' },
    'client.appointment_reminder': { title: '{shop}', body: 'Mâine la {slot} ai programare la {shop}: {service}.' },
    'client.appointment_reminder_today': { title: '{shop}', body: 'Azi la {slot} ai programare la {shop}: {service}.' },
    'client.new_message': { title: '{sender}', body: '{preview}' },
    'client.review_reply': { title: '{shop}', body: '{shop} a răspuns la recenzia ta.' },
    'client.doc_expiry': { title: '{car}', body: '{doc} expiră în {days}, pe {expiry}.' },
    'client.doc_expiry_today': { title: '{car}', body: '{doc} expiră azi.' },
    'client.doc_expiry_past': { title: '{car}', body: '{doc} a expirat pe {expiry}.' },
    'client.report_ready': { title: 'Raportul e gata', body: 'Raportul de istoric pentru {car_plate} e gata de descărcat. Cod: {code}.' },
    'client.review_report_decided': {
      title: 'Recenzie ștearsă',
      body: 'Echipa Service-Hub a șters recenzia ta pentru {shop} ({ref}), pentru că nu respectă regulile platformei.',
    },
    // ------------------------------------------------------------------ to the shop
    'shop.booking_requested': { title: 'Cerere nouă', body: '{client}: {service}, {when}. {car_plate}.' },
    'shop.booking_cancelled_client': { title: 'Programare anulată', body: '{client} a anulat programarea {ref} din {when}.' },
    'shop.booking_cancelled_admin': {
      title: 'Programare anulată',
      body: 'Echipa Service-Hub a anulat programarea {ref} ({client}, {when}). Motiv: {reason}',
    },
    'shop.quote_accepted': {
      title: 'Deviz acceptat',
      body: '{client} a acceptat devizul pentru {car_plate}: {total}. Poți începe lucrarea.',
    },
    'shop.quote_partially_accepted': {
      title: 'Deviz acceptat parțial',
      body: '{client} a acceptat {total} din {total_sent} pentru {car_plate}.',
    },
    'shop.quote_refused': { title: 'Deviz refuzat', body: '{client} a refuzat devizul pentru {car_plate}.' },
    'shop.quote_refused_fee': {
      title: 'Deviz refuzat',
      body: '{client} a refuzat devizul pentru {car_plate}. Taxa de constatare: {fee}.',
    },
    'shop.quote_expiring': {
      title: 'Deviz fără răspuns',
      body: 'Devizul pentru {client} ({car}) expiră {deadline_rel} și nu are încă răspuns.',
    },
    'shop.quote_expired': {
      title: 'Deviz expirat',
      body: 'Devizul pentru {client} ({car}) a expirat fără răspuns. Locul s-a eliberat.',
    },
    'shop.new_message': { title: '{sender}', body: '{preview}' },
    'shop.new_review': { title: 'Recenzie nouă', body: '{client} ți-a dat {rating} din 5 stele.' },
    'shop.daily_digest': { title: 'Programul de azi', body: '{digest}' },
    // ------------------------------------------------------------------ to the shop's owner (T14)
    'shop.trial_ending': {
      title: 'Perioada gratuită se termină',
      body: 'Perioada gratuită se termină în {days}, pe {expiry}. Activează abonamentul ca service-ul să rămână în căutări.',
    },
    'shop.trial_ending_today': {
      title: 'Perioada gratuită se termină',
      body: 'Perioada gratuită se termină azi. Activează abonamentul ca service-ul să rămână în căutări.',
    },
    'shop.payment_failed': {
      title: 'Plata nu a trecut',
      body: 'Nu am putut încasa abonamentul de {total}. Verifică sau schimbă cardul din Abonament. Reîncercăm pe {expiry}.',
    },
    'shop.payment_failed_final': {
      title: 'Plata nu a trecut',
      body: 'Nu am putut încasa abonamentul de {total}. A fost ultima încercare: plătește din Abonament ca service-ul să rămână în căutări.',
    },
    'shop.shop_inactive': {
      title: 'Service-ul nu mai apare în căutări',
      body: 'Perioada gratuită s-a încheiat. Activează abonamentul ca să primești din nou programări. Datele tale rămân.',
    },
    'shop.shop_inactive_payment': {
      title: 'Service-ul nu mai apare în căutări',
      body: 'Plata abonamentului nu a trecut. Plătește din Abonament ca să primești din nou programări. Datele tale rămân.',
    },
    'shop.shop_inactive_cancelled': {
      title: 'Service-ul nu mai apare în căutări',
      body: 'Abonamentul s-a încheiat. Îl poți reactiva oricând din Abonament. Datele tale rămân.',
    },
    'shop.shop_inactive_admin': {
      title: 'Service-ul nu mai apare în căutări',
      body: 'Echipa Service-Hub a oprit abonamentul. Scrie-ne dacă ai întrebări. Datele tale rămân.',
    },
    'shop.review_report_decided': {
      title: 'Recenzia rămâne publicată',
      body: 'Am verificat recenzia raportată pentru {ref} ({rating} din 5 stele). Respectă regulile, așa că rămâne publicată.',
    },
    'shop.review_report_decided_removed': {
      title: 'Recenzia raportată a fost ștearsă',
      body: 'Am șters recenzia pentru {ref} ({rating} din 5 stele). Nu mai apare și nu mai contează la medie.',
    },
  },
  en: {
    // ------------------------------------------------------------------ to the client
    'client.booking_confirmed': { title: '{shop}', body: 'Your booking {ref} is confirmed: {when}.' },
    'client.booking_declined': { title: '{shop}', body: "The shop can't take booking {ref} on {when}." },
    'client.booking_declined_reason': {
      title: '{shop}',
      body: "The shop can't take booking {ref} on {when}. Reason: {reason}",
    },
    'client.booking_rescheduled': { title: '{shop}', body: 'Your booking {ref} was moved: {when}.' },
    'client.booking_cancelled_shop': {
      title: '{shop}',
      body: 'The shop canceled booking {ref} on {when}. Reason: {reason}',
    },
    'client.booking_cancelled_admin': {
      title: BRAND,
      body: 'Booking {ref} at {shop} was canceled by the Service-Hub team. Reason: {reason}',
    },
    'client.no_show': { title: '{shop}', body: 'Booking {ref} on {when} was marked as a no-show.' },
    'client.inspection_started': { title: '{shop}', body: 'Your {car} is being inspected. The quote will come in the app.' },
    'client.quote_sent': { title: '{shop}', body: 'The quote for your {car} is ready: {total}. Please answer by {deadline}.' },
    'client.quote_replaced': { title: '{shop}', body: 'The shop changed the quote for your {car}: {total}.' },
    'client.quote_withdrawn': { title: '{shop}', body: 'The shop withdrew the quote for your {car}.' },
    'client.quote_expiring': {
      title: '{shop}',
      body: 'The quote for your {car} expires {deadline_rel}. Answer to keep your slot.',
    },
    'client.quote_expired': { title: '{shop}', body: 'The quote for your {car} expired without an answer.' },
    'client.work_started': { title: '{shop}', body: 'Work on your {car} has started.' },
    'client.job_done': { title: '{shop}', body: 'Your {car} is ready for pickup. Total: {cost}.' },
    'client.appointment_reminder': { title: '{shop}', body: 'Reminder: your booking at {shop} is tomorrow at {slot} ({service}).' },
    'client.appointment_reminder_today': { title: '{shop}', body: 'Reminder: your booking at {shop} is today at {slot} ({service}).' },
    'client.new_message': { title: '{sender}', body: '{preview}' },
    'client.review_reply': { title: '{shop}', body: '{shop} replied to your review.' },
    'client.doc_expiry': { title: '{car}', body: 'The {doc} expires in {days}, on {expiry}.' },
    'client.doc_expiry_today': { title: '{car}', body: 'The {doc} expires today.' },
    'client.doc_expiry_past': { title: '{car}', body: 'The {doc} expired on {expiry}.' },
    'client.report_ready': { title: 'Your report is ready', body: 'The history report for {car_plate} is ready to download. Code: {code}.' },
    'client.review_report_decided': {
      title: 'Review removed',
      body: 'The Service-Hub team removed your review of {shop} ({ref}) because it breaks the platform rules.',
    },
    // ------------------------------------------------------------------ to the shop
    'shop.booking_requested': { title: 'New request', body: '{client}: {service}, {when}. {car_plate}.' },
    'shop.booking_cancelled_client': { title: 'Booking canceled', body: '{client} canceled booking {ref} on {when}.' },
    'shop.booking_cancelled_admin': {
      title: 'Booking canceled',
      body: 'The Service-Hub team canceled booking {ref} ({client}, {when}). Reason: {reason}',
    },
    'shop.quote_accepted': {
      title: 'Quote accepted',
      body: '{client} accepted the quote for the {car_plate}: {total}. You can start the work.',
    },
    'shop.quote_partially_accepted': {
      title: 'Quote partially accepted',
      body: '{client} accepted {total} of {total_sent} for the {car_plate}.',
    },
    'shop.quote_refused': { title: 'Quote declined', body: '{client} declined the quote for the {car_plate}.' },
    'shop.quote_refused_fee': {
      title: 'Quote declined',
      body: '{client} declined the quote for the {car_plate}. Inspection fee: {fee}.',
    },
    'shop.quote_expiring': {
      title: 'Quote not answered',
      body: 'The quote for {client} ({car}) expires {deadline_rel} and has no answer yet.',
    },
    'shop.quote_expired': {
      title: 'Quote expired',
      body: 'The quote for {client} ({car}) expired without an answer. The slot is free again.',
    },
    'shop.new_message': { title: '{sender}', body: '{preview}' },
    'shop.new_review': { title: 'New review', body: '{client} gave you {rating} out of 5 stars.' },
    'shop.daily_digest': { title: "Today's schedule", body: '{digest}' },
    // ------------------------------------------------------------------ to the shop's owner (T14)
    'shop.trial_ending': {
      title: 'Your free period is ending',
      body: 'Your free period ends in {days}, on {expiry}. Activate the subscription to stay in search results.',
    },
    'shop.trial_ending_today': {
      title: 'Your free period is ending',
      body: 'Your free period ends today. Activate the subscription to stay in search results.',
    },
    'shop.payment_failed': {
      title: 'Payment failed',
      body: "We couldn't charge the {total} subscription. Check or change your card under Subscription. We'll try again on {expiry}.",
    },
    'shop.payment_failed_final': {
      title: 'Payment failed',
      body: "We couldn't charge the {total} subscription. That was the last try: pay under Subscription to stay in search results.",
    },
    'shop.shop_inactive': {
      title: 'Your shop is no longer in search',
      body: 'Your free period has ended. Activate the subscription to receive bookings again. Your data is kept.',
    },
    'shop.shop_inactive_payment': {
      title: 'Your shop is no longer in search',
      body: "The subscription payment didn't go through. Pay under Subscription to receive bookings again. Your data is kept.",
    },
    'shop.shop_inactive_cancelled': {
      title: 'Your shop is no longer in search',
      body: 'Your subscription has ended. You can reactivate it anytime under Subscription. Your data is kept.',
    },
    'shop.shop_inactive_admin': {
      title: 'Your shop is no longer in search',
      body: 'The Service-Hub team stopped your subscription. Write to us if you have questions. Your data is kept.',
    },
    'shop.review_report_decided': {
      title: 'The review stays up',
      body: 'We checked the review you reported for {ref} ({rating} of 5 stars). It follows the rules, so it stays published.',
    },
    'shop.review_report_decided_removed': {
      title: 'The reported review was removed',
      body: 'We removed the review for {ref} ({rating} of 5 stars). It no longer shows and no longer counts toward your rating.',
    },
  },
};

/** Words the texts are built from (not overridable). */
const WORDS: Record<Lang, Record<string, string>> = {
  ro: {
    car: 'mașina ta',
    carShop: 'mașina',
    client: 'Clientul',
    today: 'azi',
    tomorrow: 'mâine',
    relAt: '{day} la {time}',
    relOn: 'pe {date}, la {time}',
    deadline: '{date}, ora {time}',
    'doc.itp': 'ITP-ul',
    'doc.rca': 'RCA-ul',
    'doc.vignette': 'Rovinieta',
    'days.one': '{n} zi',
    'days.few': '{n} zile',
    'days.other': '{n} de zile',
    'digest.one': 'Azi ai o programare, la {first}.',
    'digest.few': 'Azi ai {n} programări, prima la {first}.',
    'digest.other': 'Azi ai {n} de programări, prima la {first}.',
    'digest.pending.one': 'O cerere nouă așteaptă răspuns.',
    'digest.pending.few': '{n} cereri noi așteaptă răspuns.',
    'digest.pending.other': '{n} de cereri noi așteaptă răspuns.',
  },
  en: {
    car: 'car',
    carShop: 'car',
    client: 'The client',
    today: 'today',
    tomorrow: 'tomorrow',
    relAt: '{day} at {time}',
    relOn: 'on {date} at {time}',
    deadline: '{date}, {time}',
    'doc.itp': 'ITP',
    'doc.rca': 'RCA insurance',
    'doc.vignette': 'road vignette',
    'days.one': '{n} day',
    'days.few': '{n} days',
    'days.other': '{n} days',
    'digest.one': 'You have 1 booking today, at {first}.',
    'digest.few': 'You have {n} bookings today, the first at {first}.',
    'digest.other': 'You have {n} bookings today, the first at {first}.',
    'digest.pending.one': '1 new request is waiting for an answer.',
    'digest.pending.few': '{n} new requests are waiting for an answer.',
    'digest.pending.other': '{n} new requests are waiting for an answer.',
  },
};

/** The events that reach each side, with the channels their texts cover. */
export const EVENTS: Record<Side, readonly string[]> = {
  client: [
    'booking_confirmed', 'booking_declined', 'booking_rescheduled', 'booking_cancelled_shop', 'booking_cancelled_admin',
    'no_show', 'inspection_started', 'quote_sent', 'quote_replaced', 'quote_withdrawn', 'quote_expiring', 'quote_expired',
    'work_started', 'job_done', 'appointment_reminder', 'new_message', 'review_reply', 'doc_expiry', 'report_ready',
    'review_report_decided',
  ],
  shop: [
    'booking_requested', 'booking_cancelled_client', 'booking_cancelled_admin', 'quote_accepted',
    'quote_partially_accepted', 'quote_refused', 'quote_expiring', 'quote_expired', 'new_message', 'new_review',
    'daily_digest', 'trial_ending', 'payment_failed', 'shop_inactive', 'review_report_decided',
  ],
};

const pluralRules: Record<Lang, Intl.PluralRules> = {
  ro: new Intl.PluralRules('ro-RO'),
  en: new Intl.PluralRules('en-US'),
};

function word(lang: Lang, key: string, params: Record<string, string | number> = {}): string {
  return interpolate(WORDS[lang][key] ?? key, params);
}

function plural(lang: Lang, base: string, n: number): string {
  const category = pluralRules[lang].select(n);
  const form = category === 'one' ? 'one' : category === 'few' ? 'few' : 'other';
  return word(lang, `${base}.${form}`, { n });
}

export function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** "mâine la 14:00", "azi la 09:30", else "pe 26 sept, la 14:00". */
function relativeDeadline(lang: Lang, iso: string, now: Date): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const time = formatTime(lang, at);
  const date = formatDayMonth(lang, at);
  const diff = daysBetween(ymdInBucharest(at), now);
  if (diff === 0) return word(lang, 'relAt', { day: word(lang, 'today'), time });
  if (diff === 1) return word(lang, 'relAt', { day: word(lang, 'tomorrow'), time });
  return word(lang, 'relOn', { date, time });
}

/** Every placeholder a text may use, always defined (an unknown value becomes empty). */
function vars(e: NotificationEvent, lang: Lang, side: Side, now: Date): Record<string, string> {
  const p = e.params ?? {};
  const make = str(p.make);
  const model = str(p.model);
  const plate = str(p.plate);
  const carName = [make, model].filter(Boolean).join(' ');
  const car = carName || word(lang, side === 'client' ? 'car' : 'carShop');
  const date = str(p.date);
  const slot = str(p.slot);
  const when = date ? [formatDate(lang, date), slot].filter(Boolean).join(', ') : slot;
  const money = (v: unknown) => {
    const n = num(v);
    return n === null ? '' : formatMoney(lang, n);
  };
  const expires = str(p.expires_at);
  const expiresAt = expires ? new Date(expires) : null;
  const days = num(p.days);
  const today = num(p.today) ?? 0;
  const pending = num(p.pending) ?? 0;
  const digest = [
    today > 0 ? plural(lang, 'digest', today).replace('{first}', str(p.first_slot)) : '',
    pending > 0 ? plural(lang, 'digest.pending', pending) : '',
  ]
    .filter(Boolean)
    .join(' ');
  const odometer = num(p.odometer);
  const docKey = `doc.${str(p.doc)}`;

  return {
    ref: str(p.ref),
    shop: str(p.shop_name) || BRAND,
    client: str(p.client_name) || word(lang, 'client'),
    sender: str(p.sender_name) || BRAND,
    preview: str(p.preview),
    car,
    car_plate: plate ? `${car} (${plate})` : car,
    service: e.service ? e.service[lang] : '',
    when,
    slot,
    reason: str(p.reason),
    total: money(p.total),
    total_sent: money(p.total_sent),
    cost: money(p.cost),
    fee: money(p.inspection_fee),
    odometer: odometer === null ? '' : formatKm(lang, odometer),
    deadline:
      expiresAt && !Number.isNaN(expiresAt.getTime())
        ? word(lang, 'deadline', { date: formatDayMonth(lang, expiresAt), time: formatTime(lang, expiresAt) })
        : '',
    deadline_rel: expires ? relativeDeadline(lang, expires, now) : '',
    rating: str(p.rating),
    doc: WORDS[lang][docKey] ?? str(p.doc).toUpperCase(),
    days: days === null ? '' : plural(lang, 'days', Math.abs(days)),
    expiry: str(p.expiry) ? formatDayMonth(lang, str(p.expiry)) : '',
    digest,
    code: str(p.code),
  };
}

/** Which text: the event, with a variant where the parameters change the sentence. */
export function templateKey(side: Side, e: NotificationEvent): string {
  const p = e.params ?? {};
  const base = `${side}.${e.event}`;
  switch (e.event) {
    case 'booking_declined':
      return str(p.reason) ? `${base}_reason` : base;
    case 'quote_refused':
      return (num(p.inspection_fee) ?? 0) > 0 ? `${base}_fee` : base;
    case 'appointment_reminder':
      return p.day === 'today' ? `${base}_today` : base;
    case 'doc_expiry': {
      const days = num(p.days) ?? 0;
      return days < 0 ? `${base}_past` : days === 0 ? `${base}_today` : base;
    }
    case 'trial_ending':
      return (num(p.days) ?? 0) <= 0 ? `${base}_today` : base;
    case 'payment_failed':
      return p.final === true || !str(p.expiry) ? `${base}_final` : base;
    case 'shop_inactive':
      return p.reason === 'payment_failed'
        ? `${base}_payment`
        : p.reason === 'cancelled'
          ? `${base}_cancelled`
          : p.reason === 'admin'
            ? `${base}_admin`
            : base;
    case 'review_report_decided':
      return side === 'shop' && p.decision === 'removed' ? `${base}_removed` : base;
    default:
      return base;
  }
}

/** The app screen a tap on the notification opens. */
export function urlFor(side: Side, e: NotificationEvent): string {
  const p = e.params ?? {};
  const booking = e.booking_id ?? str(p.booking_id);
  const q = (params: Record<string, string>) => new URLSearchParams(params).toString();
  if (side === 'client') {
    switch (e.event) {
      case 'new_message':
        return str(p.thread_id) ? `/c/mesaje/${str(p.thread_id)}` : '/c/mesaje';
      case 'doc_expiry':
        return str(p.car_id) ? `/c/garaj/${str(p.car_id)}` : '/c/garaj';
      case 'report_ready':
        return REPORTS_PATH;
      default:
        return booking ? `/c/programari?${q({ p: booking })}` : '/c/programari';
    }
  }
  switch (e.event) {
    case 'new_message':
      return str(p.thread_id) ? `/s/mesaje/${str(p.thread_id)}` : '/s/mesaje';
    case 'new_review':
    case 'review_report_decided':
      return '/s/cont/recenzii';
    case 'daily_digest':
      return '/s/panou';
    case 'trial_ending':
    case 'payment_failed':
    case 'shop_inactive':
      return SUBSCRIPTION_PATH;
    case 'booking_requested':
      return booking ? `/s/programari?${q({ tab: 'cereri', p: booking })}` : '/s/programari?tab=cereri';
    // Ended bookings are in the history, found by their code.
    case 'booking_cancelled_client':
    case 'booking_cancelled_admin':
    case 'quote_refused':
    case 'quote_expired':
      return str(p.ref) ? `/s/istoric?${q({ q: str(p.ref) })}` : '/s/istoric';
    default:
      return booking ? `/s/programari?${q({ p: booking })}` : '/s/programari';
  }
}

function tagFor(e: NotificationEvent): string {
  const p = e.params ?? {};
  switch (e.event) {
    case 'new_message':
      return `thread-${str(p.thread_id)}`;
    case 'doc_expiry':
      return `car-${str(p.car_id)}-${str(p.doc)}`;
    case 'daily_digest':
      return `digest-${str(p.date)}`;
    case 'new_review':
    case 'review_report_decided':
      return `review-${str(p.review_id)}`;
    case 'report_ready':
      return `report-${str(p.report_id)}`;
    case 'trial_ending':
    case 'payment_failed':
    case 'shop_inactive':
      return 'subscription';
    default: {
      const booking = e.booking_id ?? str(p.booking_id);
      return booking ? `booking-${booking}` : e.event;
    }
  }
}

const firstUpper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The screen where notices show (T16b): Caută for clients, Panou for shops. */
export const NOTICE_PATHS: Record<Side, string> = { client: '/c/cauta', shop: '/s/panou' };

/**
 * A notice from the Service-Hub team (T16b): the admin wrote its title and text in both
 * languages; the recipient gets their own (the Romanian one when the English is missing). A tap
 * opens the screen where the notice shows.
 */
function renderBroadcast(e: NotificationEvent, side: Side, lang: Lang): Rendered | null {
  const p = e.params ?? {};
  const title = str(p[`title_${lang}`]) || str(p.title_ro);
  const body = str(p[`body_${lang}`]) || str(p.body_ro);
  if (!title && !body) return null;
  return {
    key: 'broadcast',
    title: clip(title || BRAND, 80),
    body: clip(body.replace(/\s+/g, ' ').trim(), 240),
    url: NOTICE_PATHS[side],
    tag: `notice-${str(p.notice_id)}`,
  };
}

/**
 * The notification for one outbox event, or null when the recipient's side has no text for it
 * (the dispatcher records `no_template` and moves on).
 */
export function renderNotification(e: NotificationEvent, overrides: Overrides = {}, now: Date = new Date()): Rendered | null {
  const side: Side | null = e.role === 'client' ? 'client' : e.role === 'shop' ? 'shop' : null;
  if (!side) return null;
  const lang: Lang = e.lang === 'en' ? 'en' : 'ro';
  if (e.event === 'broadcast') return renderBroadcast(e, side, lang);
  const key = templateKey(side, e);
  const base = TEMPLATES[lang][key];
  if (!base) return null;
  const custom = overrides?.[key]?.[lang];
  const text: Text = {
    title: typeof custom?.title === 'string' && custom.title.trim() ? custom.title : base.title,
    body: typeof custom?.body === 'string' && custom.body.trim() ? custom.body : base.body,
  };
  const v = vars(e, lang, side, now);
  return {
    key,
    title: clip(firstUpper(interpolate(text.title, v).trim()), 80) || BRAND,
    body: clip(firstUpper(interpolate(text.body, v).replace(/\s+/g, ' ').trim()), 240),
    url: urlFor(side, e),
    tag: tagFor(e),
  };
}
