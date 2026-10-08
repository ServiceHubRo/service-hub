import type { Coords } from './geo';

/**
 * Zones (Eduard, 8 Oct): the 41 counties and Bucharest, as `list_service_areas()` answers them.
 * The client's position is placed here, in the browser — the nearest town of the list decides, the
 * same rule as `area_for_point()` in the database — so it never leaves the phone; only the zone a
 * client chooses to wait for is saved.
 */
export interface AreaAnchor {
  n: string;
  lat: number;
  lng: number;
}

export interface ServiceArea {
  code: string;
  name_ro: string;
  name_en: string;
  anchors: AreaAnchor[];
  /** Service-Hub works there now (automatic: a public shop; or set by the admin). */
  live: boolean;
}

/** Romania's box: outside it a position has no zone (the same bounds as the database). */
const BOX = { latMin: 43.5, latMax: 48.4, lngMin: 20.2, lngMax: 29.8 };

/** The zone of a position: the one of its nearest town; null outside Romania or without zones. */
export function areaForPoint<T extends Pick<ServiceArea, 'anchors'>>(areas: readonly T[], at: Coords): T | null {
  const { latitude: lat, longitude: lng } = at;
  if (lat < BOX.latMin || lat > BOX.latMax || lng < BOX.lngMin || lng > BOX.lngMax) return null;
  const k = Math.cos((lat * Math.PI) / 180);
  let best: T | null = null;
  let bestD = Infinity;
  for (const a of areas) {
    for (const t of a.anchors) {
      const d = (lat - t.lat) ** 2 + ((lng - t.lng) * k) ** 2;
      if (d < bestD) {
        bestD = d;
        best = a;
      }
    }
  }
  return best;
}

/** Bucharest is named on its own; the counties as "județul X" / "X County" (the i18n key decides). */
export const isCapital = (code: string) => code === 'B';
