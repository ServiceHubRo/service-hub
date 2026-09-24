/**
 * Straight-line distance (ARCHITECTURE §8). Distance is a display and a sort option only; it never
 * enters the ranking score. The client's position lives in memory only (src/lib/location.ts).
 */

export interface Coords {
  latitude: number;
  longitude: number;
}

const EARTH_RADIUS_KM = 6371;

function radians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Haversine distance in km — the same formula search_shops uses. */
export function distanceKm(a: Coords, b: Coords): number {
  const dLat = radians(b.latitude - a.latitude);
  const dLng = radians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

interface Located {
  latitude: number | null;
  longitude: number | null;
}

/** Distance from `from` to a shop, or null when either side has no coordinates. */
export function distanceTo(from: Coords | null, shop: Located): number | null {
  if (!from || shop.latitude === null || shop.longitude === null) return null;
  return distanceKm(from, { latitude: shop.latitude, longitude: shop.longitude });
}

/**
 * "Cele mai apropiate": nearest first; shops without a distance keep their rating order after the
 * others. The input is already in rating order, and the sort is stable.
 */
export function sortByDistance<T>(items: T[], distance: (item: T) => number | null): T[] {
  return [...items].sort((a, b) => {
    const da = distance(a);
    const db = distance(b);
    if (da === null && db === null) return 0;
    if (da === null) return 1;
    if (db === null) return -1;
    return da - db;
  });
}

/** How far "Aproape de tine" reaches, and how many shops it shows. */
export const NEARBY_RADIUS_KM = 25;
export const NEARBY_MAX = 3;

/** "Aproape de tine": the closest shops within the radius, nearest first. */
export function nearby<T>(items: T[], distance: (item: T) => number | null): T[] {
  return sortByDistance(
    items.filter((item) => {
      const d = distance(item);
      return d !== null && d <= NEARBY_RADIUS_KM;
    }),
    distance,
  ).slice(0, NEARBY_MAX);
}
