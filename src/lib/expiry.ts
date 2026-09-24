import { daysFromToday } from '../i18n/format';

/**
 * Car document expiry (FR §3.4, P7): ITP, RCA and the vignette. Counted in Europe/Bucharest
 * calendar days, so "azi" is the same for everyone whatever the device zone.
 */
export type CarDoc = 'itp' | 'rca' | 'vignette';

export const CAR_DOCS: readonly { doc: CarDoc; column: 'itp_expiry' | 'rca_expiry' | 'vignette_expiry' }[] = [
  { doc: 'itp', column: 'itp_expiry' },
  { doc: 'rca', column: 'rca_expiry' },
  { doc: 'vignette', column: 'vignette_expiry' },
];

/** Within this many days a document is flagged (amber), and the Caută banner mentions it. */
export const EXPIRY_WARN_DAYS = 30;

/** ok: more than 30 days left (muted) · soon: 1–30 days (amber) · expired: today or earlier (red). */
export type Urgency = 'ok' | 'soon' | 'expired';

export function urgencyOf(days: number): Urgency {
  if (days <= 0) return 'expired';
  return days <= EXPIRY_WARN_DAYS ? 'soon' : 'ok';
}

export interface ExpiryCar {
  id: string;
  make: string;
  model: string;
  itp_expiry: string | null;
  rca_expiry: string | null;
  vignette_expiry: string | null;
}

export interface ExpiryAlert {
  carId: string;
  /** "Golf 7": the model is how people name their car. */
  carName: string;
  doc: CarDoc;
  date: string;
  days: number;
  urgency: Exclude<Urgency, 'ok'>;
}

/** Every document that expires within 30 days or has expired, most urgent first. */
export function expiryAlerts(cars: readonly ExpiryCar[], now: Date = new Date()): ExpiryAlert[] {
  const alerts: ExpiryAlert[] = [];
  for (const car of cars) {
    for (const { doc, column } of CAR_DOCS) {
      const date = car[column];
      if (!date) continue;
      const days = daysFromToday(date, now);
      const urgency = urgencyOf(days);
      if (urgency === 'ok') continue;
      alerts.push({ carId: car.id, carName: car.model || car.make, doc, date, days, urgency });
    }
  }
  return alerts.sort((a, b) => a.days - b.days);
}
