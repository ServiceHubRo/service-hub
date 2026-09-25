// geocode — the shop's address → latitude/longitude, after "Salvează" in Setări → Profil public
// (FR §4.6, ARCHITECTURE §11). Coordinates feed "Aproape de tine" in the client search.
//
// 1. Checks the caller's access token with the Auth server and finds the shop they own (an
//    admin names the shop: { shop_id }, after editing its address — T16a).
// 2. Reads the address from the database (never from the request) and asks OpenStreetMap
//    Nominatim, most precise first: street + city + county + postal code, then without the postal
//    code, then the city alone.
// 3. Stores what it found on the shop. When Nominatim knows no such place the old coordinates are
//    cleared (no location beats a wrong one); when Nominatim cannot be reached nothing changes.
// Answers { found, precision: 'address' | 'city' | null, latitude, longitude }.
//
// Nominatim's rules: an identifying User-Agent and at most one request per second. The app calls
// this only when the address changed, so a shop makes a handful of requests a year.
import { adminApi } from '../_shared/admin.ts';
import { bearerToken, corsHeaders, json } from '../_shared/http.ts';
import { reportError } from '../_shared/monitor.ts';

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'Service-Hub/1.0 (https://service-hub.ro)';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Address {
  street: string | null;
  city: string | null;
  county: string | null;
  postal_code: string | null;
}

type Precision = 'address' | 'city';

async function search(params: Record<string, string>): Promise<{ lat: number; lng: number } | null> {
  const url = new URL(NOMINATIM);
  for (const [k, v] of Object.entries({ ...params, country: 'Romania', format: 'jsonv2', limit: '1' })) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'ro' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`nominatim ${res.status}`);
  const hits = (await res.json()) as { lat?: string; lon?: string }[];
  const hit = hits[0];
  const lat = Number(hit?.lat);
  const lng = Number(hit?.lon);
  return hit && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

const clean = (value: string | null) => (value ?? '').trim();

async function locate(a: Address): Promise<{ lat: number; lng: number; precision: Precision } | null> {
  const city = clean(a.city);
  if (!city) return null;
  const county = clean(a.county);
  const street = clean(a.street);
  const postal = clean(a.postal_code);
  const base: Record<string, string> = county ? { city, county } : { city };

  const attempts: [Record<string, string>, Precision][] = [];
  if (street && postal) attempts.push([{ ...base, street, postalcode: postal }, 'address']);
  if (street) attempts.push([{ ...base, street }, 'address']);
  attempts.push([base, 'city']);

  for (const [i, [params, precision]] of attempts.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1000)); // one request per second
    const hit = await search(params);
    if (hit) return { ...hit, precision };
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const api = adminApi();
    const user = await api.userFromToken(bearerToken(req));
    if (!user) return json({ error: 'not_signed_in' }, 401);

    // The admin (T16a) asks for a shop they just edited: { shop_id }. Everyone else gets their own.
    let asked: unknown = null;
    try {
      asked = ((await req.json()) as { shop_id?: unknown } | null)?.shop_id ?? null;
    } catch {
      asked = null; // no body: the caller's own shop
    }
    let shopId: unknown;
    if (typeof asked === 'string' && UUID.test(asked)) {
      const me = await api.select(`profiles?select=role,suspended&id=eq.${encodeURIComponent(user.id)}`);
      if (me[0]?.role !== 'admin' || me[0]?.suspended === true) return json({ error: 'not_allowed' }, 403);
      shopId = asked;
    } else {
      const staff = await api.select(
        // The address is the owner's setting (after T19b): only the owner's save asks for the map.
        `shop_staff?select=shop_id&user_id=eq.${encodeURIComponent(user.id)}&role=eq.owner&accepted_at=not.is.null`,
      );
      shopId = staff[0]?.shop_id;
    }
    if (typeof shopId !== 'string') return json({ error: 'not_allowed' }, 403);
    const shops = await api.select(`shops?select=street,city,county,postal_code&id=eq.${shopId}`);
    const address = shops[0] as unknown as Address | undefined;
    if (!address) return json({ error: 'not_allowed' }, 403);

    let place;
    try {
      place = await locate(address);
    } catch (e) {
      console.error('geocode: nominatim unreachable', e instanceof Error ? e.message : e);
      return json({ error: 'unavailable' }, 503);
    }

    await api.update(`shops?id=eq.${shopId}`, {
      latitude: place?.lat ?? null,
      longitude: place?.lng ?? null,
    });
    return json({
      found: place !== null,
      precision: place?.precision ?? null,
      latitude: place?.lat ?? null,
      longitude: place?.lng ?? null,
    });
  } catch (e) {
    await reportError('geocode', e);
    return json({ error: 'unknown' }, 500);
  }
});
