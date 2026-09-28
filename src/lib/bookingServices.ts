/**
 * Several services in one booking (T21): the client ticks up to five on step 1. The first one is
 * the booking's service; the others go with it (bookings.extra_service_ids). The same limit is in
 * create_booking.
 */
export const MAX_BOOKING_SERVICES = 5;

/** `?serviciu=ulei,frane` → ['ulei', 'frane']: each once, in order, at most five. */
export function parseServiceIds(value: string | null | undefined): string[] {
  const ids: string[] = [];
  for (const raw of (value ?? '').split(',')) {
    const id = raw.trim();
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids.slice(0, MAX_BOOKING_SERVICES);
}

/** Ticks or unticks one service; a sixth tick is ignored. */
export function toggleServiceId(ids: readonly string[], id: string): string[] {
  if (ids.includes(id)) return ids.filter((x) => x !== id);
  return ids.length >= MAX_BOOKING_SERVICES ? [...ids] : [...ids, id];
}

/**
 * A booking's services in one short line: "Schimb ulei", "Schimb ulei, Frâne", and from three on
 * the first one and how many more ("Schimb ulei și încă 2", through `more`). A comma between
 * services: some names have a "+" of their own ("Schimb ulei + filtru ulei").
 */
export const SERVICE_SEPARATOR = ', ';

export function servicesLine(names: readonly string[], more: (first: string, n: number) => string): string {
  if (names.length <= 2) return names.join(SERVICE_SEPARATOR);
  return more(names[0]!, names.length - 1);
}

/** A service as a booking carries it (names in both languages). */
export interface NamedService {
  name_ro: string | null;
  name_en: string | null;
}

/** A service added to a booking, as the database lists it (`extra_services`). */
export interface ExtraService extends NamedService {
  id: string;
  icon: string | null;
}

/**
 * Every service of a booking, in the reader's language: the first one, then those added to it.
 * `fallback` stands in for a first service without a name (its id).
 */
export function bookingServiceNames(
  lang: 'ro' | 'en',
  first: NamedService | null,
  extra: readonly NamedService[] | null | undefined,
  fallback: string,
): string[] {
  const name = (s: NamedService) => (lang === 'ro' ? s.name_ro : s.name_en) ?? s.name_ro ?? s.name_en ?? '';
  return [first ? name(first) || fallback : fallback, ...(extra ?? []).map(name)].filter(Boolean);
}

/** The same, in one line: "Schimb ulei + filtru ulei, Plăcuțe de frână". */
export function bookingServicesText(
  lang: 'ro' | 'en',
  first: NamedService | null,
  extra: readonly NamedService[] | null | undefined,
  fallback: string,
): string {
  return bookingServiceNames(lang, first, extra, fallback).join(SERVICE_SEPARATOR);
}

/** The same for a row with flat names (`service_ro`, `service_en`) and `extra_services`. */
export function rowServicesText(
  lang: 'ro' | 'en',
  row: { service_id: string; service_ro: string | null; service_en: string | null; extra_services?: readonly NamedService[] | null },
): string {
  return bookingServicesText(lang, { name_ro: row.service_ro, name_en: row.service_en }, row.extra_services, row.service_id);
}
