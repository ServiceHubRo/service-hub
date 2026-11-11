/**
 * Admin routes. Since A1 (Eduard, 7 Nov 2026) the admin works in five zones — Panou, Parteneri,
 * Activitate, Suport, Platformă — each with one level of sub-sections (src/app/adminZones.ts).
 * Cont is the admin's own account (language, legal documents, logging out), not a list of tools.
 */
export const ADMIN_PANEL_PATH = '/admin/panou';
export const ADMIN_PARTNERS_PATH = '/admin/parteneri';
export const ADMIN_ACTIVITY_PATH = '/admin/activitate';
export const ADMIN_SUPPORT_PATH = '/admin/suport';
export const ADMIN_PLATFORM_PATH = '/admin/platforma';
export const ADMIN_ACCOUNT_PATH = '/admin/cont';

// Parteneri
export const ADMIN_CLIENTS_PATH = `${ADMIN_PARTNERS_PATH}/clienti`;
export const ADMIN_SHOPS_PATH = `${ADMIN_PARTNERS_PATH}/service-uri`;
/** Firme și flote (T64a): companies, their plans and trials. */
export const ADMIN_FLEETS_PATH = `${ADMIN_PARTNERS_PATH}/firme`;
/** Verificare ANAF: every shop's company as ANAF answered it. */
export const ADMIN_ANAF_PATH = `${ADMIN_PARTNERS_PATH}/anaf`;
/** Vehicule duplicate (T66): the same car recorded twice by one owner. */
export const ADMIN_DUPLICATES_PATH = `${ADMIN_PARTNERS_PATH}/duplicate`;

// Activitate
export const ADMIN_BOOKINGS_PATH = `${ADMIN_ACTIVITY_PATH}/programari`;
export const ADMIN_MODERATION_PATH = `${ADMIN_ACTIVITY_PATH}/moderare`;
/** Contestațiile de neprezentare (T53), a page of their own since A1. */
export const ADMIN_DISPUTES_PATH = `${ADMIN_ACTIVITY_PATH}/contestatii`;
export const ADMIN_SUBSCRIPTIONS_PATH = `${ADMIN_ACTIVITY_PATH}/abonamente`;
export const ADMIN_REPORTS_PATH = `${ADMIN_ACTIVITY_PATH}/rapoarte`;
export const ADMIN_EXPORT_PATH = `${ADMIN_ACTIVITY_PATH}/export`;

// Suport
/** Solicitări (A3a): the support requests, the suggestions (T26) among them, and the escalations. */
export const ADMIN_REQUESTS_PATH = `${ADMIN_SUPPORT_PATH}/solicitari`;
export const adminRequestPath = (id: string) => `${ADMIN_REQUESTS_PATH}/${id}`;
/** Păstrare legală (A3c2a): the support data kept for a dispute or an authority, admin only. */
export const ADMIN_HOLDS_PATH = `${ADMIN_SUPPORT_PATH}/pastrare-legala`;
export const adminHoldPath = (id: string) => `${ADMIN_HOLDS_PATH}/${id}`;

// Platformă
export const ADMIN_SETTINGS_PATH = `${ADMIN_PLATFORM_PATH}/setari`;
export const ADMIN_TEXTS_PATH = `${ADMIN_PLATFORM_PATH}/texte`;
export const ADMIN_NOTICES_PATH = `${ADMIN_PLATFORM_PATH}/anunturi`;
/** Zone: where Service-Hub works and who waits (Eduard, 8 Oct). */
export const ADMIN_ZONES_PATH = `${ADMIN_PLATFORM_PATH}/zone`;
export const ADMIN_CATALOG_PATH = `${ADMIN_PLATFORM_PATH}/catalog`;
export const ADMIN_AUDIT_PATH = `${ADMIN_PLATFORM_PATH}/jurnal`;
export const ADMIN_FLEET_FAILED_PATH = `${ADMIN_PLATFORM_PATH}/notificari-flota`;
/** Echipa de suport (A2): the support agents, appointing and withdrawing the role. */
export const ADMIN_TEAM_PATH = `${ADMIN_PLATFORM_PATH}/echipa`;

export const adminShopPath = (id: string) => `${ADMIN_SHOPS_PATH}/${id}`;
export const adminClientPath = (id: string) => `${ADMIN_CLIENTS_PATH}/${id}`;
export const adminBookingPath = (id: string) => `${ADMIN_BOOKINGS_PATH}/${id}`;

/** Programări already filtered to one shop or one client. */
export function adminBookingsLink(filter: { shop?: string; client?: string }): string {
  const params = new URLSearchParams();
  if (filter.shop) params.set('service', filter.shop);
  if (filter.client) params.set('client', filter.client);
  const q = params.toString();
  return q ? `${ADMIN_BOOKINGS_PATH}?${q}` : ADMIN_BOOKINGS_PATH;
}

/**
 * The admin's addresses before A1 and where each one lives now. Kept at least until A8 (Eduard, 7 Nov
 * 2026, E3): links in favourites, history and old messages keep working. `/admin/cont` itself is not
 * here: it is still the admin's own account.
 */
export const ADMIN_LEGACY_ROUTES: readonly (readonly [old: string, now: string])[] = [
  ['/admin/prezentare', ADMIN_PANEL_PATH],
  ['/admin/clienti', ADMIN_CLIENTS_PATH],
  ['/admin/service-uri', ADMIN_SHOPS_PATH],
  ['/admin/rezervari', ADMIN_BOOKINGS_PATH],
  ['/admin/moderare', ADMIN_MODERATION_PATH],
  ['/admin/cont/flote', ADMIN_FLEETS_PATH],
  ['/admin/cont/anaf', ADMIN_ANAF_PATH],
  ['/admin/cont/duplicate', ADMIN_DUPLICATES_PATH],
  ['/admin/cont/abonamente', ADMIN_SUBSCRIPTIONS_PATH],
  ['/admin/cont/rapoarte', ADMIN_REPORTS_PATH],
  ['/admin/cont/export', ADMIN_EXPORT_PATH],
  ['/admin/cont/sugestii', ADMIN_REQUESTS_PATH],
  // A3a: Sugestii became Solicitări.
  ['/admin/suport/sugestii', ADMIN_REQUESTS_PATH],
  ['/admin/cont/setari/texte', ADMIN_TEXTS_PATH],
  ['/admin/cont/setari', ADMIN_SETTINGS_PATH],
  ['/admin/cont/anunturi', ADMIN_NOTICES_PATH],
  ['/admin/cont/zone', ADMIN_ZONES_PATH],
  ['/admin/cont/catalog', ADMIN_CATALOG_PATH],
  ['/admin/cont/jurnal', ADMIN_AUDIT_PATH],
  ['/admin/cont/notificari-flota', ADMIN_FLEET_FAILED_PATH],
];

/**
 * Where an old admin address lives now, or null when the address is not an old one. The longest
 * matching start wins (`/admin/cont/setari/texte` before `/admin/cont/setari`), a start only matches
 * whole path segments (`/admin/clientix` is not `/admin/clienti`), and the rest of the path (a fișă's
 * ID, exactly as it was written, encoded characters included) follows. Query and hash are the
 * caller's to keep.
 */
export function legacyAdminPath(pathname: string): string | null {
  let best: readonly [string, string] | null = null;
  for (const route of ADMIN_LEGACY_ROUTES) {
    const [old] = route;
    if ((pathname === old || pathname.startsWith(`${old}/`)) && (!best || old.length > best[0].length)) best = route;
  }
  return best ? best[1] + pathname.slice(best[0].length) : null;
}
