import { expect, test, type Page } from '@playwright/test';
import {
  BACKEND,
  SEED,
  SEED_ADMIN_TOTP,
  SEED_PASSWORD,
  adminZoneLink,
  expectNoHorizontalScroll,
  isDesktop,
  serviceRest,
  shot,
  signIn,
  switchLanguage,
  totp,
} from './support';

// A1 — the admin's five zones (Panou · Parteneri · Activitate · Suport · Platformă): every function of
// the inventory opens from the new menu (lists, fișe and tools, each with what it shows), the
// addresses from before A1 open the same page at the new address without adding a history entry
// (query, ID and anchor kept), the way back (the phone's or the browser's, and the app's „‹ Înapoi”)
// never loops, and the menu fits at every width.

const name = () => test.info().project.name;
const historyLength = (page: Page) => page.evaluate(() => window.history.length);
const main = (page: Page) => page.locator('main');
const h1 = (page: Page) => page.getByRole('heading', { level: 1 });
const backLink = (page: Page) => page.locator('[data-back-bar]').getByRole('link');

test.beforeEach(async ({ context, page }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
  // The demo admin is shared by tests running in parallel: its saved language never changes.
  await page.route('**/rest/v1/profiles?*', (route) =>
    route.request().method() === 'PATCH' ? route.fulfill({ status: 204 }) : route.continue(),
  );
});

async function signInAdmin(page: Page) {
  await signIn(page, SEED.admin, SEED_PASSWORD);
  await expect(h1(page)).toHaveText('Panou principal');
}

/** The screen is there (its title) and has loaded its data: no skeleton, no load error. */
async function loaded(page: Page) {
  await expect(h1(page)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByText('Datele nu s-au încărcat.')).toHaveCount(0);
}

interface Fn {
  zone: string;
  item: string;
  path: string;
  title: string;
  /** What the screen shows once loaded (beyond its title). */
  shows?: (page: Page) => Promise<void>;
}

const label = (page: Page, text: string) => async () => {
  await expect(page.getByLabel(text).first()).toBeVisible();
};

/** Every list and tool of the inventory (the fișe and Panou are checked in their own tests). */
const FUNCTIONS = (page: Page): Fn[] => [
  { zone: 'Parteneri', item: 'Clienți', path: '/admin/parteneri/clienti', title: 'Clienți', shows: label(page, 'Caută după nume, email, telefon sau C-00001') },
  { zone: 'Parteneri', item: 'Service-uri', path: '/admin/parteneri/service-uri', title: 'Service-uri', shows: label(page, 'Caută după nume, oraș, email, telefon sau S-00001') },
  { zone: 'Parteneri', item: 'Firme și flote', path: '/admin/parteneri/firme', title: 'Firme și flote' },
  { zone: 'Parteneri', item: 'Verificare ANAF', path: '/admin/parteneri/anaf', title: 'Verificare ANAF', shows: label(page, 'Caută după service, cod, CUI sau denumire') },
  { zone: 'Parteneri', item: 'Vehicule duplicate', path: '/admin/parteneri/duplicate', title: 'Vehicule duplicate' },
  { zone: 'Activitate', item: 'Programări', path: '/admin/activitate/programari', title: 'Programări', shows: label(page, 'Caută după cod, număr, client sau service') },
  {
    zone: 'Activitate',
    item: 'Moderare',
    path: '/admin/activitate/moderare',
    title: 'Moderare',
    shows: async () => {
      await expect(main(page).getByText('Toate recenziile')).toBeVisible();
      await expect(main(page).getByRole('link', { name: /^Contestații de neprezentare/ })).toBeVisible();
    },
  },
  {
    zone: 'Activitate',
    item: 'Contestații de neprezentare',
    path: '/admin/activitate/contestatii',
    title: 'Contestații de neprezentare',
    shows: async () => {
      await expect(main(page).getByText(/^Contestații la neprezentări \(\d+\)$/)).toBeVisible();
    },
  },
  { zone: 'Activitate', item: 'Abonamente și plăți', path: '/admin/activitate/abonamente', title: 'Abonamente și plăți', shows: label(page, 'Caută service, oraș, cont, email, Stripe') },
  {
    zone: 'Activitate',
    item: 'Rapoarte de istoric',
    path: '/admin/activitate/rapoarte',
    title: 'Rapoarte de istoric',
    // The search appears once a report exists; before, the empty list says so.
    shows: async () => {
      await expect(page.getByLabel('Caută cod, număr, mașină, client').or(main(page).getByText('Nu există rapoarte.')).first()).toBeVisible();
    },
  },
  {
    zone: 'Activitate',
    item: 'Export',
    path: '/admin/activitate/export',
    title: 'Export',
    shows: async () => {
      await expect(main(page).getByRole('button', { name: 'Descarcă tot' }).first()).toBeVisible();
    },
  },
  { zone: 'Suport', item: 'Solicitări', path: '/admin/suport/solicitari', title: 'Solicitări' },
  {
    zone: 'Platformă',
    item: 'Setări platformă',
    path: '/admin/platforma/setari',
    title: 'Setări platformă',
    shows: async () => {
      await expect(page.getByLabel('Zile pentru răspuns la deviz')).toHaveValue(/^\d+$/);
    },
  },
  { zone: 'Platformă', item: 'Textele notificărilor', path: '/admin/platforma/texte', title: 'Textele notificărilor', shows: label(page, 'Caută în texte') },
  { zone: 'Platformă', item: 'Anunțuri', path: '/admin/platforma/anunturi', title: 'Anunțuri' },
  { zone: 'Platformă', item: 'Zone', path: '/admin/platforma/zone', title: 'Zone' },
  { zone: 'Platformă', item: 'Catalog de servicii', path: '/admin/platforma/catalog', title: 'Catalog de servicii' },
  { zone: 'Platformă', item: 'Jurnal de audit', path: '/admin/platforma/jurnal', title: 'Jurnal de audit' },
  { zone: 'Platformă', item: 'Notificări flotă eșuate', path: '/admin/platforma/notificari-flota', title: 'Notificări flotă eșuate' },
  // A2
  { zone: 'Platformă', item: 'Echipa de suport', path: '/admin/platforma/echipa', title: 'Echipa de suport', shows: label(page, 'ID cont sau email') },
  // A3c2b1
  { zone: 'Suport', item: 'Sugestii de verificat', path: '/admin/suport/sugestii-de-verificat', title: 'Sugestii de verificat', shows: label(page, 'Afișează') },
  // A4
  { zone: 'Suport', item: 'Centrul de ajutor', path: '/admin/suport/centrul-de-ajutor', title: 'Centrul de ajutor', shows: label(page, 'Caută articol') },
  {
    zone: 'Platformă',
    item: 'Retenția datelor',
    path: '/admin/platforma/retentie',
    title: 'Retenția datelor',
    shows: async () => {
      await expect(main(page).getByRole('button', { name: 'Previzualizează' }).first()).toBeVisible();
    },
  },
];

const ZONES = [
  { label: 'Panou', path: '/admin/panou', title: 'Panou principal' },
  { label: 'Parteneri', path: '/admin/parteneri', title: 'Parteneri' },
  { label: 'Activitate', path: '/admin/activitate', title: 'Activitate' },
  { label: 'Suport', path: '/admin/suport', title: 'Suport' },
  { label: 'Platformă', path: '/admin/platforma', title: 'Platformă' },
];

/**
 * Opens an address signed out, then signs in on the sign-in page it was sent to (as a person does,
 * without reloading it: the page remembers the address asked for), both steps for the admin. The
 * demo admin is shared by tests running at the same time: when its session is taken over before the
 * code is typed, it starts again from the address.
 */
async function signInFrom(page: Page, asked: string) {
  const code = page.getByLabel('Codul de 6 cifre');
  const lost = page.getByRole('dialog', { name: 'Sesiunea a expirat' }).or(page.getByRole('button', { name: 'Încearcă din nou' }));
  for (let attempt = 1; ; attempt++) {
    await page.goto(asked);
    await expect(page).toHaveURL(/\/intra$/);
    await page.getByLabel('Email').fill(SEED.admin);
    await page.getByLabel('Parolă', { exact: true }).fill(SEED_PASSWORD);
    await page.getByRole('button', { name: 'Intră în cont' }).click();
    await expect(code.or(lost).first()).toBeVisible({ timeout: 15_000 });
    if (await code.isVisible()) {
      await code.fill(totp(SEED_ADMIN_TOTP));
      await page.getByRole('button', { name: 'Confirmă' }).click();
      await expect(code).toHaveCount(0, { timeout: 8_000 }).catch(() => {});
      if ((await code.count()) === 0 && !(await lost.first().isVisible())) return;
    }
    if (attempt >= 6) throw new Error('the admin could not pass the second step');
    await page.context().clearCookies();
    await page.evaluate(() => {
      for (const k of Object.keys(localStorage)) if (k.startsWith('sb-')) localStorage.removeItem(k);
      for (const k of Object.keys(sessionStorage)) if (k.startsWith('sb-')) sessionStorage.removeItem(k);
    });
    await page.waitForTimeout(400 * attempt);
  }
}

async function seed(): Promise<{ shopId: string; clientId: string; bookingId: string; bookingRef: string }> {
  const [shop] = await serviceRest<{ id: string }[]>('shops?name=eq.Atelier%20Demo&select=id', 'GET');
  const [client] = await serviceRest<{ id: string }[]>(`profiles?role=eq.client&select=id&order=created_at.asc&limit=1`, 'GET');
  const [booking] = await serviceRest<{ id: string; ref: string }[]>('bookings?select=id,ref&order=created_at.asc&limit=1', 'GET');
  return { shopId: shop!.id, clientId: client!.id, bookingId: booking!.id, bookingRef: booking!.ref };
}

test.describe('A1 — admin navigation', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');
  test.describe.configure({ timeout: 240_000 });

  test('the five zones and every function of the inventory open from the menu, each with what it shows', async ({ page }) => {
    await signInAdmin(page);
    await expect(main(page).getByText('Activitate recentă')).toBeVisible();

    // The five zones, in this order, nothing else in the main navigation (a phone: the bottom bar).
    for (const zone of ZONES) {
      await adminZoneLink(page, zone.label).click();
      await expect(page).toHaveURL(new RegExp(`${zone.path}$`));
      await expect(h1(page)).toHaveText(zone.title);
      await expect(adminZoneLink(page, zone.label)).toHaveAttribute('aria-current', 'page');
    }

    // Every list and tool: its zone, its tile, its screen with its data; „‹ Înapoi” names the zone.
    for (const fn of FUNCTIONS(page)) {
      await adminZoneLink(page, fn.zone).click();
      await main(page).getByRole('link', { name: new RegExp(`^${fn.item}`) }).first().click();
      await expect(page, fn.item).toHaveURL(new RegExp(`${fn.path}$`));
      await expect(h1(page)).toHaveText(fn.title);
      await loaded(page);
      await fn.shows?.(page);
      await expect(backLink(page)).toHaveText(new RegExp(fn.zone));
      // The zone stays marked while one of its sub-sections is open.
      await expect(adminZoneLink(page, fn.zone)).toHaveAttribute('aria-current', 'page');
      await expectNoHorizontalScroll(page);
    }

    // From 1024 px: the open zone lists its sub-sections in the sidebar, one level, the current one marked.
    if (isDesktop(page)) {
      const sidebar = page.getByRole('navigation', { name: 'Navigare principală' }).filter({ visible: true });
      await adminZoneLink(page, 'Platformă').click();
      const sub = sidebar.getByRole('list', { name: 'Platformă' });
      await expect(sub.getByRole('link')).toHaveText([
        'Setări platformă',
        'Textele notificărilor',
        'Anunțuri',
        'Zone',
        'Catalog de servicii',
        'Jurnal de audit',
        'Notificări flotă eșuate',
        'Echipa de suport',
        'Retenția datelor',
      ]);
      await sub.getByRole('link', { name: 'Anunțuri' }).click();
      await expect(h1(page)).toHaveText('Anunțuri');
      await expect(sub.getByRole('link', { name: 'Anunțuri' })).toHaveAttribute('aria-current', 'page');
      // Another zone: Platformă's sub-sections close, Activitate's open.
      await adminZoneLink(page, 'Activitate').click();
      await expect(sidebar.getByRole('list', { name: 'Platformă' })).toHaveCount(0);
      await expect(sidebar.getByRole('list', { name: 'Activitate' }).getByRole('link')).toHaveCount(6);
    } else {
      // A phone or a tablet: exactly the five zones in the bottom bar.
      const bar = page.getByRole('navigation', { name: 'Navigare principală' }).filter({ visible: true });
      await expect(bar.getByRole('link')).toHaveCount(5);
    }

    // Platformă shows its two groups.
    await adminZoneLink(page, 'Platformă').click();
    await expect(main(page).getByRole('heading', { level: 2, name: 'Configurare' })).toBeVisible();
    await expect(main(page).getByRole('heading', { level: 2, name: 'Control' })).toBeVisible();
    await shot(page, 'a1-platform', name());
    for (const zone of ['Parteneri', 'Activitate', 'Suport']) {
      await adminZoneLink(page, zone).click();
      await expect(h1(page)).toHaveText(zone);
      await shot(page, `a1-${zone.toLowerCase()}`, name());
    }
  });

  test('the fișe open from their lists; „‹ Înapoi” and the browser Back go the same way, without loops', async ({ page }) => {
    const s = await seed();
    await signInAdmin(page);

    // Client: Parteneri → Clienți → fișă.
    await adminZoneLink(page, 'Parteneri').click();
    await main(page).getByRole('link', { name: /^Clienți/ }).click();
    await page.getByLabel('Caută după nume, email, telefon sau C-00001').fill('client@service-hub.test');
    await main(page).getByRole('link', { name: /client@service-hub\.test/ }).first().click();
    await expect(page).toHaveURL(/\/admin\/parteneri\/clienti\/[0-9a-f-]{36}$/);
    await loaded(page);
    await expect(h1(page)).not.toHaveText('');
    await expect(backLink(page)).toHaveText(/Clienți/);
    const length = await historyLength(page);
    // „‹ Clienți” then „‹ Parteneri”: back through the history, no entry added.
    await backLink(page).click();
    await expect(page).toHaveURL(/\/admin\/parteneri\/clienti(\?.*)?$/);
    await backLink(page).click();
    await expect(page).toHaveURL(/\/admin\/parteneri$/);
    expect(await historyLength(page), 'no entry added by „‹ Înapoi”').toBe(length);
    // Forward finds them again, in order; Back retraces.
    await page.goForward();
    await expect(page).toHaveURL(/\/admin\/parteneri\/clienti(\?.*)?$/);
    await page.goForward();
    await expect(page).toHaveURL(/\/admin\/parteneri\/clienti\/[0-9a-f-]{36}$/);
    await page.goBack();
    await page.goBack();
    await page.goBack();
    await expect(page).toHaveURL(/\/admin\/panou$/);

    // Shop: Parteneri → Service-uri → fișă (by its address) → „‹ Service-uri” replaces, then Back.
    await page.goto(`/admin/parteneri/service-uri/${s.shopId}`);
    await expect(h1(page)).toHaveText('Atelier Demo');
    await loaded(page);
    const before = await historyLength(page);
    await backLink(page).click();
    await expect(page).toHaveURL(/\/admin\/parteneri\/service-uri$/);
    await expect(h1(page)).toHaveText('Service-uri');
    expect(await historyLength(page), 'replaced, not added').toBe(before);

    // Booking: Activitate → Programări → fișă → „‹ Programări” → „‹ Activitate” → Back.
    await adminZoneLink(page, 'Activitate').click();
    await main(page).getByRole('link', { name: /^Programări/ }).click();
    await page.getByLabel('Caută după cod, număr, client sau service').fill(s.bookingRef);
    await main(page).getByRole('link', { name: new RegExp(s.bookingRef) }).first().click();
    await expect(page).toHaveURL(new RegExp(`/admin/activitate/programari/${s.bookingId}$`));
    await loaded(page);
    await expect(backLink(page)).toHaveText(/Programări/);
    await backLink(page).click();
    await expect(h1(page)).toHaveText('Programări');
    await backLink(page).click();
    await expect(h1(page)).toHaveText('Activitate');
    await page.goBack();
    await expect(page).not.toHaveURL(/\/admin\/activitate\/programari/);

    // Each tool in one place only: Setări platformă has no second way into Textele notificărilor.
    await adminZoneLink(page, 'Platformă').click();
    await main(page).getByRole('link', { name: /^Setări platformă/ }).click();
    await expect(h1(page)).toHaveText('Setări platformă');
    await expect(main(page).getByRole('link', { name: /^Textele notificărilor/ })).toHaveCount(0);
    await backLink(page).click();
    await main(page).getByRole('link', { name: /^Textele notificărilor/ }).click();
    await expect(h1(page)).toHaveText('Textele notificărilor');
    await backLink(page).click();
    await expect(h1(page)).toHaveText('Platformă');
  });

  test('every address from before A1 opens its page at the new address, with its query, ID and anchor', async ({ page }) => {
    const s = await seed();
    await signInAdmin(page);

    const map: [string, string][] = [
      ['/admin/prezentare', '/admin/panou'],
      ['/admin/clienti', '/admin/parteneri/clienti'],
      ['/admin/service-uri', '/admin/parteneri/service-uri'],
      ['/admin/rezervari', '/admin/activitate/programari'],
      ['/admin/moderare', '/admin/activitate/moderare'],
      ['/admin/cont/flote', '/admin/parteneri/firme'],
      ['/admin/cont/anaf', '/admin/parteneri/anaf'],
      ['/admin/cont/duplicate', '/admin/parteneri/duplicate'],
      ['/admin/cont/abonamente', '/admin/activitate/abonamente'],
      ['/admin/cont/rapoarte', '/admin/activitate/rapoarte'],
      ['/admin/cont/export', '/admin/activitate/export'],
      ['/admin/cont/sugestii', '/admin/suport/solicitari'],
      ['/admin/suport/sugestii', '/admin/suport/solicitari'],
      ['/admin/cont/setari/texte', '/admin/platforma/texte'],
      ['/admin/cont/setari', '/admin/platforma/setari'],
      ['/admin/cont/anunturi', '/admin/platforma/anunturi'],
      ['/admin/cont/zone', '/admin/platforma/zone'],
      ['/admin/cont/catalog', '/admin/platforma/catalog'],
      ['/admin/cont/jurnal', '/admin/platforma/jurnal'],
      ['/admin/cont/notificari-flota', '/admin/platforma/notificari-flota'],
      // Fișe keep their ID.
      [`/admin/clienti/${s.clientId}`, `/admin/parteneri/clienti/${s.clientId}`],
      [`/admin/service-uri/${s.shopId}`, `/admin/parteneri/service-uri/${s.shopId}`],
      [`/admin/rezervari/${s.bookingId}`, `/admin/activitate/programari/${s.bookingId}`],
    ];
    for (const [old, now] of map) {
      await page.goto(old);
      await expect(page, old).toHaveURL(new RegExp(`${now.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
      await loaded(page);
    }

    // Several query parameters, in either order, exactly as written; the anchor too.
    for (const query of [`?service=${s.shopId}&client=${s.clientId}&q=P-0`, `?q=P-0&client=${s.clientId}&service=${s.shopId}`]) {
      await page.goto(`/admin/rezervari${query}#lista`);
      await expect(page).toHaveURL(`/admin/activitate/programari${query}#lista`);
      expect(new URL(page.url()).search).toBe(query);
      expect(new URL(page.url()).hash).toBe('#lista');
    }
    // Special characters in an ID and in the query, encoded as they were.
    const odd = 'a%20b%C8%99%2Fc';
    await page.goto(`/admin/clienti/${odd}?q=%C8%99%20%26%20x&filtru=suspendati#sus`);
    await expect(page).toHaveURL(`/admin/parteneri/clienti/${odd}?q=%C8%99%20%26%20x&filtru=suspendati#sus`);
    await expect(page.getByText('Datele nu s-au încărcat.').or(page.getByText(/nu există/i)).first()).toBeVisible();

    // Overlapping starts: the longest one wins; a start matches whole segments only.
    await page.goto('/admin/cont/setari/texte?q=new_review');
    await expect(page).toHaveURL('/admin/platforma/texte?q=new_review');
    await page.goto('/admin/cont/setari');
    await expect(page).toHaveURL('/admin/platforma/setari');
    await page.goto('/admin/cont');
    await expect(page).toHaveURL('/admin/cont');
    await expect(h1(page)).toHaveText('Cont');
    await page.goto('/admin/cont/legal/termeni');
    await expect(page).toHaveURL('/admin/cont/legal/termeni');
    await page.goto('/admin/clientix');
    await expect(page.getByRole('heading', { level: 1, name: 'Pagina nu există' })).toBeVisible();

    // The redirect replaces the entry: one entry for the page, Back goes to the page before.
    await page.goto('/admin/panou');
    await expect(h1(page)).toHaveText('Panou principal');
    const length = await historyLength(page);
    // Inside the app (an old link followed without reloading the page).
    await page.evaluate(() => {
      history.pushState(history.state, '', '/admin/cont/flote?plan=fleet_pro');
      window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    });
    await expect(page).toHaveURL('/admin/parteneri/firme?plan=fleet_pro');
    await expect(h1(page)).toHaveText('Firme și flote');
    expect(await historyLength(page)).toBe(length + 1);
    await page.goBack();
    await expect(page).toHaveURL('/admin/panou');
    await page.goForward();
    await expect(page).toHaveURL('/admin/parteneri/firme?plan=fleet_pro');
  });

  test('an old or a new address opened before signing in: after the two steps of sign-in, its page, query kept', async ({ browser }) => {
    const s = await seed();
    for (const [asked, landed] of [
      [`/admin/rezervari?client=${s.clientId}&service=${s.shopId}`, `/admin/activitate/programari?client=${s.clientId}&service=${s.shopId}`],
      [`/admin/parteneri/service-uri/${s.shopId}`, `/admin/parteneri/service-uri/${s.shopId}`],
    ]) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.addInitScript(() => localStorage.setItem('sh_lang', 'ro'));
      await page.route('**/rest/v1/profiles?*', (route) =>
        route.request().method() === 'PATCH' ? route.fulfill({ status: 204 }) : route.continue(),
      );
      await signInFrom(page, asked!);
      await expect(page).toHaveURL(landed!);
      await loaded(page);
      await ctx.close();
    }
  });

  test('Cont is the admin’s own account; clients and shops never reach the zones', async ({ page, browser }) => {
    await signInAdmin(page);
    // The header's icon on a phone and a tablet, the bottom of the sidebar from 1024 px.
    await page.getByRole('link', { name: 'Cont', exact: true }).filter({ visible: true }).first().click();
    await expect(h1(page)).toHaveText('Cont');
    await expect(page.getByLabel('Limba')).toBeVisible();
    await expect(main(page).getByRole('link', { name: /^Termeni și condiții/ })).toBeVisible();
    // No tool tile any more: they live in the zones.
    for (const tool of ['Abonamente și plăți', 'Jurnal de audit', 'Setări platformă', 'Solicitări', 'Export']) {
      await expect(main(page).getByRole('link', { name: new RegExp(`^${tool}`) })).toHaveCount(0);
    }
    await shot(page, 'a1-account', name());

    for (const [email, home] of [
      [SEED.client, /\/c\/cauta$/],
      [SEED.shop, /\/s\/panou$/],
    ] as const) {
      const ctx = await browser.newContext();
      const other = await ctx.newPage();
      await other.addInitScript(() => localStorage.setItem('sh_lang', 'ro'));
      await signIn(other, email, SEED_PASSWORD);
      await expect(other).toHaveURL(home);
      for (const path of ['/admin/parteneri/clienti', '/admin/platforma/setari', '/admin/cont/flote']) {
        await other.goto(path);
        await expect(other).toHaveURL(home);
      }
      await ctx.close();
    }
  });

  test('in English', async ({ page }) => {
    await signInAdmin(page);
    await switchLanguage(page, 'en');
    await expect(h1(page)).toHaveText('Dashboard');
    for (const [zone, item, title] of [
      ['Partners', 'Companies and fleets', 'Companies and fleets'],
      ['Activity', 'No-show disputes', 'No-show disputes'],
      ['Platform', 'Platform settings', 'Platform settings'],
    ] as const) {
      await adminZoneLink(page, zone).click();
      await expect(h1(page)).toHaveText(zone);
      await main(page).getByRole('link', { name: new RegExp(`^${item}`) }).first().click();
      await expect(h1(page)).toHaveText(title);
      await expect(backLink(page)).toHaveText(new RegExp(zone));
    }
    await adminZoneLink(page, 'Platform').click();
    await expect(main(page).getByRole('heading', { level: 2, name: 'Configuration' })).toBeVisible();
    await expect(main(page).getByRole('heading', { level: 2, name: 'Oversight' })).toBeVisible();
    await shot(page, 'a1-platform-en', name());
  });

  test('every width: no horizontal scroll, the five zones whole, nothing cut or overlapping', async ({ page }) => {
    test.skip(name() !== 'desktop-1440', 'one project walks every width');
    test.setTimeout(900_000);
    const s = await seed();
    await signInAdmin(page);
    const pages = [
      ...ZONES.map((z) => z.path),
      ...FUNCTIONS(page).map((f) => f.path),
      `/admin/parteneri/clienti/${s.clientId}`,
      `/admin/parteneri/service-uri/${s.shopId}`,
      `/admin/activitate/programari/${s.bookingId}`,
      '/admin/cont',
    ];
    for (const width of [320, 375, 390, 430, 768, 1024, 1920]) {
      await page.setViewportSize({ width, height: width < 1024 ? 844 : 900 });
      for (const path of pages) {
        await page.goto(path);
        await loaded(page);
        await expectNoHorizontalScroll(page);
        const nav = page.getByRole('navigation', { name: 'Navigare principală' }).filter({ visible: true });
        // By their names (a count badge is read out after the label: „Activitate, 2 recenzii raportate”).
        const zones = nav.getByRole('link', { name: /^(Panou|Parteneri|Activitate|Suport|Platformă)( ?,.*)?$/ });
        await expect(zones, `${width} ${path}`).toHaveCount(5);
        // Each zone's label whole (not cut by an ellipsis), the zones apart from each other.
        const check = await zones.evaluateAll((links) => {
          const cut = links.flatMap((link) =>
            Array.from(link.querySelectorAll('span'))
              .filter((s) => s.children.length === 0 && !s.closest('[aria-hidden="true"]') && !s.classList.contains('visually-hidden'))
              .filter((s) => s.scrollWidth > s.clientWidth + 1)
              .map((s) => s.textContent),
          );
          const boxes = links.map((l) => l.getBoundingClientRect());
          let overlap = false;
          for (let i = 0; i < boxes.length; i++)
            for (let j = i + 1; j < boxes.length; j++) {
              const a = boxes[i]!;
              const b = boxes[j]!;
              if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlap = true;
            }
          return { cut, overlap };
        });
        expect(check.cut, `${width} ${path}: cut labels`).toEqual([]);
        expect(check.overlap, `${width} ${path}: overlapping items`).toBe(false);
      }
      await page.goto('/admin/activitate');
      await loaded(page);
      await page.screenshot({ path: `test-results/shots/a1-width-${width}.png` });
    }
  });
});
