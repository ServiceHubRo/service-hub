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
}

export interface VehicleFile {
  booking_id: string;
  car: CarSnapshot & { vin?: string | null };
  client_name: string | null;
  client_phone: string | null;
  has_client: boolean;
  share: VehicleFileShare;
  /** Newest first. */
  own: OwnVehicleFileJob[];
  /** Newest first; empty unless `share` is 'shared'. */
  others: VehicleFileJob[];
}

export async function fetchVehicleFile(bookingId: string): Promise<VehicleFile> {
  const data = (await call('shop_vehicle_file', { p_booking_id: bookingId })) as unknown as VehicleFile;
  return {
    ...data,
    own: data.own.map((j) => ({ ...j, cost: j.cost === null ? null : Number(j.cost) })),
  };
}

/** The highest odometer reading among the jobs the shop can see, or null. */
export function lastKnownOdometer(file: Pick<VehicleFile, 'own' | 'others'>): number | null {
  const readings = [...file.own, ...file.others].map((j) => j.odometer).filter((km): km is number => km !== null);
  return readings.length > 0 ? Math.max(...readings) : null;
}
