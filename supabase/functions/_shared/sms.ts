// SMS texts (ARCHITECTURE §9): strictly about one booking or one code, identifiable as
// Service-Hub, with the way to stop them, in one 160-character message without diacritics.
import { smsSafe } from './smso.ts';
import { formatDate, type Lang } from './format.ts';
import { servicesText, type NotificationEvent } from './templates.ts';

export const SMS_MAX = 160;

const NEW_REQUEST: Record<Lang, { head: string; tail: string; client: string }> = {
  ro: { head: 'Service-Hub: cerere noua de la', tail: 'Raspunde in aplicatie. Oprire SMS: Setari > Notificari', client: 'un client' },
  en: { head: 'Service-Hub: new request from', tail: 'Reply in the app. Stop SMS: Settings > Notifications', client: 'a client' },
};
/** A booking that came in confirmed at once (T28a): nothing to answer, only to know. */
const NEW_CONFIRMED: Record<Lang, { head: string; tail: string; client: string }> = {
  ro: { head: 'Service-Hub: programare confirmata automat,', tail: 'Detalii in aplicatie. Oprire SMS: Setari > Notificari', client: 'un client' },
  en: { head: 'Service-Hub: booking confirmed automatically,', tail: 'Details in the app. Stop SMS: Settings > Notifications', client: 'a client' },
};

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(0, n - 3)).trimEnd()}...` : s);

/**
 * The SMS for an outbox event (only a new booking to a shop has one: a request, or one confirmed
 * at once), or null:
 * "Service-Hub: cerere noua de la Maria Pop, Dum 27 sept, 10:00: Schimb ulei. Raspunde in …".
 * The service name gives way first when it is too long, then the client's name.
 */
export function smsForEvent(e: NotificationEvent, app = 'https://service-hub.ro'): string | null {
  if (e.event === 'walk_in_invite') return walkInSms(e, app);
  if ((e.event !== 'booking_requested' && e.event !== 'booking_auto_confirmed') || e.role !== 'shop') return null;
  const lang: Lang = e.lang === 'en' ? 'en' : 'ro';
  const t = (e.event === 'booking_auto_confirmed' ? NEW_CONFIRMED : NEW_REQUEST)[lang];
  const p = e.params ?? {};
  const date = str(p.date);
  const when = smsSafe([date ? formatDate(lang, date) : '', str(p.slot)].filter(Boolean).join(', '));
  let client = smsSafe(str(p.client_name)) || t.client;
  let service = smsSafe(servicesText(e, lang));
  const build = () => `${t.head} ${client}${when ? `, ${when}` : ''}${service ? `: ${service}` : ''}. ${t.tail}`;
  let text = build();
  if (text.length > SMS_MAX && service) {
    service = clip(service, Math.max(8, service.length - (text.length - SMS_MAX)));
    text = build();
  }
  if (text.length > SMS_MAX) {
    client = clip(client, Math.max(6, client.length - (text.length - SMS_MAX)));
    text = build();
  }
  return text.slice(0, SMS_MAX);
}

/** The invitation of a booking the shop added (T29): where, when, and the link to it. */
const WALK_IN: Record<Lang, { head: string; tail: string }> = {
  ro: { head: 'Service-Hub: programarea ta la', tail: 'Vezi-o in aplicatie:' },
  en: { head: 'Service-Hub: your booking at', tail: 'See it in the app:' },
};

/**
 * "Service-Hub: programarea ta la Atelier Demo, Lun 12 oct, 10:00. Vezi-o in aplicatie:
 * https://service-hub.ro/p/…". The shop's name gives way when the message would be too long.
 */
export function walkInSms(e: NotificationEvent, app: string): string | null {
  const p = e.params ?? {};
  const token = str(p.token);
  if (!token) return null;
  const lang: Lang = e.lang === 'en' ? 'en' : 'ro';
  const t = WALK_IN[lang];
  const date = str(p.date);
  const when = smsSafe([date ? formatDate(lang, date) : '', str(p.slot)].filter(Boolean).join(', '));
  const link = `${app}/p/${token}`;
  let shop = smsSafe(str(p.shop_name)) || 'Service-Hub';
  const build = () => `${t.head} ${shop}${when ? `, ${when}` : ''}. ${t.tail} ${link}`;
  let text = build();
  if (text.length > SMS_MAX) {
    shop = clip(shop, Math.max(6, shop.length - (text.length - SMS_MAX)));
    text = build();
  }
  return text.length > SMS_MAX ? `${t.head} ${shop}. ${link}`.slice(0, SMS_MAX) : text;
}

/** The verification code message. */
export function codeSms(lang: string, code: string): string {
  return lang === 'en'
    ? `Your Service-Hub code: ${code}. It expires in 10 minutes. Do not share it with anyone.`
    : `Codul tau Service-Hub: ${code}. Expira in 10 minute. Nu il da nimanui.`;
}
