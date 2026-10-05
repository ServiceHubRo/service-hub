import type { CarSnapshot } from './bookings';
import { call } from './rpc';

/**
 * Fișa mașinii (T27): `shop_vehicle_file(booking)` answers, for the shop's members only, the car of
 * one of their bookings with every job done on it at this shop and — while the client has an open
 * booking for that car here and agreed — what was done on it at other shops, without price or shop.
 */

/** 'shared': the client agreed on an open booking; 'not_shared': open booking, not agreed; 'no_active': none open. */
export type VehicleFileShare = 'shared' | 'not_shared' | 'no_active';

export interface VehicleFileJob {
  id: string;
  /** The day the job was finished, Europe/Bucharest (YYYY-MM-DD). */
  date: string;
  service_ro: string;
  service_en: string;
  service_icon: string | null;
  /** The accepted lines of the quote (names only). */
  items: string[];
  work: string | null;
  odometer: number | null;
}

export interface OwnVehicleFileJob extends VehicleFileJob {
  ref: string;
  cost: number | null;
  client_name: string | null;
  /** T31a: a job this shop brought from another program (no booking, code or quote). */
  imported?: boolean;
}

interface ImportedFileJob {
  id: string;
  date: string;
  work: string | null;
  odometer: number | null;
  cost: number | null;
  client_name: string | null;
}

export interface VehicleFile {
  booking_id: string;
  car: CarSnapshot & { vin?: string | null };
  client_name: string | null;
  client_phone: string | null;
  has_client: boolean;
  share: VehicleFileShare;
  /** Newest first, the imported jobs (T31a) among them. */
  own: OwnVehicleFileJob[];
  /** Newest first; empty unless `share` is 'shared'. */
  others: VehicleFileJob[];
}

export async function fetchVehicleFile(bookingId: string): Promise<VehicleFile> {
  const data = (await call('shop_vehicle_file', { p_booking_id: bookingId })) as unknown as VehicleFile & {
    imported?: ImportedFileJob[];
  };
  const imported: OwnVehicleFileJob[] = (data.imported ?? []).map((j) => ({
    ...j,
    service_ro: '',
    service_en: '',
    service_icon: null,
    items: [],
    ref: '',
    imported: true,
  }));
  const own = [...data.own, ...imported]
    .map((j) => ({ ...j, cost: j.cost === null ? null : Number(j.cost) }))
    // Newest first; a Service-Hub job before an imported one of the same day.
    .sort((a, b) => b.date.localeCompare(a.date) || Number(!!a.imported) - Number(!!b.imported));
  return {
    booking_id: data.booking_id,
    car: data.car,
    client_name: data.client_name,
    client_phone: data.client_phone,
    has_client: data.has_client,
    share: data.share,
    own,
    others: data.others,
  };
}

/** The highest odometer reading among the jobs the shop can see, or null. */
export function lastKnownOdometer(file: Pick<VehicleFile, 'own' | 'others'>): number | null {
  const readings = [...file.own, ...file.others].map((j) => j.odometer).filter((km): km is number => km !== null);
  return readings.length > 0 ? Math.max(...readings) : null;
}
