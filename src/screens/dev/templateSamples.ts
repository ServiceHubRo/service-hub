import { ymdInBucharest } from '../../i18n/format';
import type { BookingStatus } from '../../lib/status';

/**
 * SAMPLE DATA for the page templates (`/dev/componente/sabloane/*`, test builds only; Eduard 14 Nov
 * 2026). Invented shops, cars and amounts, dated relative to today. Never used by a real screen.
 */

export interface Text {
  ro: string;
  en: string;
}

export interface SampleBooking {
  id: string;
  ref: string;
  status: BookingStatus;
  service: Text;
  icon: string;
  shop: string;
  city: string;
  date: string;
  slot: string;
  car: string;
  plate: string;
  /** The quote's lines, when there is one. */
  lines?: { name: Text; price: number }[];
  /** A finished job: what was done and what it cost. */
  work?: Text;
  amount?: number;
}

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const BRAKES: SampleBooking['lines'] = [
  { name: { ro: 'Plăcuțe frână față', en: 'Front brake pads' }, price: 280 },
  { name: { ro: 'Discuri frână față', en: 'Front brake discs' }, price: 420 },
  { name: { ro: 'Manoperă', en: 'Labor' }, price: 150 },
];

export function sampleBookings(now: Date = new Date()): SampleBooking[] {
  const today = ymdInBucharest(now);
  const at = (days: number) => addDays(today, days);
  const golf = { car: 'Volkswagen Golf 7', plate: 'BV 12 ABC' };
  const duster = { car: 'Dacia Duster', plate: 'BV 07 DAC' };
  return [
    { id: 'b1', ref: 'P-000004', status: 'quote_sent', service: { ro: 'Plăcuțe de frână', en: 'Brake pads' }, icon: 'Disc', shop: 'Atelier Demo', city: 'Brașov', date: at(1), slot: '09:00', ...golf, lines: BRAKES },
    { id: 'b2', ref: 'P-000003', status: 'in_inspection', service: { ro: 'Diagnoză computerizată', en: 'Computer diagnostics' }, icon: 'ScanLine', shop: 'Atelier Demo', city: 'Brașov', date: at(1), slot: '11:00', ...duster },
    { id: 'b3', ref: 'P-000005', status: 'approved', service: { ro: 'Kit distribuție (curea)', en: 'Timing belt kit' }, icon: 'Cog', shop: 'Auto Precis', city: 'Codlea', date: at(1), slot: '14:00', ...duster, amount: 1350 },
    { id: 'b4', ref: 'P-000002', status: 'confirmed', service: { ro: 'Plăcuțe de frână', en: 'Brake pads' }, icon: 'Disc', shop: 'Rapid Service', city: 'Brașov', date: at(2), slot: '09:00', ...duster },
    { id: 'b5', ref: 'P-000006', status: 'in_progress', service: { ro: 'Schimb ulei + filtru ulei', en: 'Oil and oil filter change' }, icon: 'Droplet', shop: 'Auto Precis', city: 'Codlea', date: at(2), slot: '15:00', ...golf },
    { id: 'b6', ref: 'P-000001', status: 'pending', service: { ro: 'Schimb ulei + filtru ulei', en: 'Oil and oil filter change' }, icon: 'Droplet', shop: 'Atelier Demo', city: 'Brașov', date: at(3), slot: '10:00', ...golf },
    { id: 'b7', ref: 'P-000007', status: 'done', service: { ro: 'Schimb ulei + filtru ulei', en: 'Oil and oil filter change' }, icon: 'Droplet', shop: 'Rapid Service', city: 'Brașov', date: at(-40), slot: '10:00', ...golf, work: { ro: 'Schimb ulei 5W30 + filtru ulei și aer', en: '5W30 oil change + oil and air filter' }, amount: 340 },
    { id: 'b8', ref: 'P-000009', status: 'declined', service: { ro: 'Vulcanizare / reparație pană', en: 'Tire repair' }, icon: 'LifeBuoy', shop: 'Vulcanizare Roți Expres', city: 'Brașov', date: at(-5), slot: '12:00', ...duster },
    { id: 'b9', ref: 'P-000012', status: 'expired', service: { ro: 'Diagnoză computerizată', en: 'Computer diagnostics' }, icon: 'ScanLine', shop: 'Auto Precis', city: 'Codlea', date: at(-8), slot: '10:00', ...golf },
    { id: 'b10', ref: 'P-000010', status: 'cancelled', service: { ro: 'Geometrie roți (2D/3D)', en: 'Wheel alignment (2D/3D)' }, icon: 'Gauge', shop: 'Rapid Service', city: 'Brașov', date: at(-12), slot: '16:00', ...duster },
    { id: 'b11', ref: 'P-000011', status: 'quote_refused', service: { ro: 'Încărcare climatizare', en: 'A/C recharge' }, icon: 'Snowflake', shop: 'Atelier Demo', city: 'Brașov', date: at(-30), slot: '11:00', ...duster },
    { id: 'b12', ref: 'P-000013', status: 'no_show', service: { ro: 'Geometrie roți (2D/3D)', en: 'Wheel alignment (2D/3D)' }, icon: 'Gauge', shop: 'Vulcanizare Roți Expres', city: 'Brașov', date: at(-20), slot: '09:00', ...golf },
  ];
}

export interface SampleShop {
  id: string;
  name: string;
  city: string;
  services: number;
  rating: number | null;
  reviews: number;
  /** The first free day (ymd) and hour. */
  free: { date: string; time: string };
}

export function sampleShops(now: Date = new Date()): SampleShop[] {
  const today = ymdInBucharest(now);
  return [
    { id: 's1', name: 'Auto Precis', city: 'Codlea', services: 6, rating: 5, reviews: 1, free: { date: addDays(today, 2), time: '09:00' } },
    { id: 's2', name: 'Atelier Demo', city: 'Brașov', services: 7, rating: 4.5, reviews: 2, free: { date: addDays(today, 2), time: '08:00' } },
    { id: 's3', name: 'Rapid Service', city: 'Brașov', services: 6, rating: 4.5, reviews: 2, free: { date: addDays(today, 1), time: '08:00' } },
    { id: 's4', name: 'Vulcanizare Roți Expres', city: 'Brașov', services: 2, rating: null, reviews: 0, free: { date: today, time: '11:00' } },
    { id: 's5', name: 'Service Carpați', city: 'Sibiu', services: 9, rating: 4.8, reviews: 14, free: { date: addDays(today, 3), time: '10:00' } },
    { id: 's6', name: 'Moto & Auto Center', city: 'Cluj-Napoca', services: 12, rating: 4.2, reviews: 6, free: { date: addDays(today, 1), time: '13:00' } },
  ];
}

/** A help article to read (template E). */
export const SAMPLE_ARTICLE: { title: Text; lead: Text; blocks: { h?: Text; p?: Text; list?: Text[] }[] } = {
  title: { ro: 'Devize și aprobarea lucrărilor', en: 'Quotes and approving the work' },
  lead: {
    ro: 'Devizul se acceptă integral, parțial sau se refuză, direct din programare.',
    en: 'A quote is accepted in full, in part or refused, right from the booking.',
  },
  blocks: [
    {
      p: {
        ro: 'După constatare, service-ul trimite devizul: fiecare poziție cu prețul ei, totalul și termenul până la care poți răspunde. Primești o notificare și devizul apare la programare.',
        en: 'After the inspection the shop sends the quote: every line with its price, the total and the time you have to answer. You get a notification and the quote shows on the booking.',
      },
    },
    { h: { ro: 'Accepți doar o parte', en: 'Accept only part of it' } },
    {
      p: {
        ro: 'Debifează pozițiile pe care nu le accepți, apoi apasă Accept selectate. Service-ul face doar lucrările bifate.',
        en: 'Untick the lines you do not accept, then tap Accept selected. The shop does only the ticked work.',
      },
    },
    { h: { ro: 'Ce se întâmplă dacă refuzi', en: 'What happens if you refuse' } },
    {
      list: [
        { ro: 'Mașina se ridică fără lucrări.', en: 'The car is picked up without any work.' },
        { ro: 'Taxa de constatare se plătește doar dacă refuzi tot devizul.', en: 'The inspection fee is paid only if you refuse the whole quote.' },
        { ro: 'Un deviz fără răspuns expiră la termen, iar locul se eliberează.', en: 'A quote without an answer expires at its deadline and the slot is freed.' },
      ],
    },
  ],
};
