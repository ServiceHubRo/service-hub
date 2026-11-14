import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { fleetSetup } from '../e2e/fleet-support';
import { BACKEND, PASSWORD, SEED, SEED_PASSWORD, createUser, rpcAs, serviceRest, signIn, totp, userIdOf } from '../e2e/support';

/**
 * A9 — the visual audit: every screen of every role, at seven widths (phone to large desktop), in
 * Romanian (and a second pass in English at 390 and 1440 px); other widths with VISUAL_WIDTHS. For
 * each screen and width it measures what a person would see as broken (horizontal scroll, something
 * off the screen, text out of its box or clipped, small tap targets, buttons on top of each other,
 * tiny text, inputs under 16 px, images that did not load, console errors) and keeps a screenshot.
 * Nothing is asserted: the result is `visual-audit/report.json` and the screenshots, read by a person.
 *
 *   npm run test:visual   (with the local Supabase stack, like the browser tests: CLAUDE.md §9)
 */

const OUT = process.env.VISUAL_OUT ?? 'visual-audit';
/** Other widths for one run: `VISUAL_WIDTHS=375,768,1024,1440,1920` (and `VISUAL_EN_WIDTHS=375,1440`). */
const widthsFrom = (value: string | undefined, fallback: readonly number[]) =>
  value ? value.split(',').map(Number).filter((n) => n > 0) : fallback;
const WIDTHS = widthsFrom(process.env.VISUAL_WIDTHS, [390, 430, 768, 820, 1024, 1280, 1440]);
/** Full-page screenshots at these widths; the others keep the first screen only, or nothing when clean. */
const FULL = new Set<number>([375, 390, 768, 820, 1440, 1920]);
const ALWAYS_SHOT = new Set<number>(WIDTHS);
const EN_WIDTHS = widthsFrom(process.env.VISUAL_EN_WIDTHS, [390, 1440]);
const HEIGHT: Record<number, number> = { 375: 812, 390: 844, 430: 932, 768: 1024, 820: 1180, 1024: 768, 1280: 800, 1440: 900, 1920: 1080 };

const SEED_SUPPORT = { email: 'suport@service-hub.test', secret: 'KRSXG5CTKVIFAT2SKRSXG5CTKVIFAT2S' };

interface Screen {
  name: string;
  path: string;
  /** Runs after the page has loaded: opens a panel, a card, a menu. */
  prep?: (page: Page) => Promise<void>;
  /** Runs before the page is opened (a broken network for an error state); `after` undoes it. */
  before?: (page: Page) => Promise<void>;
  after?: (page: Page) => Promise<void>;
  /** Only these widths (an interaction that only exists on one layout). */
  widths?: readonly number[];
  /** No English pass (the same screen as another one, a state). */
  roOnly?: boolean;
}

interface Measured {
  overflowX: number;
  height: number;
  h1: string;
  h1Size: string;
  offscreen: string[];
  textOverflow: string[];
  clipped: string[];
  ellipsis: string[];
  smallTargets: string[];
  tinyText: string[];
  smallInputs: string[];
  overlaps: string[];
  brokenImages: string[];
  buttonHeights: Record<string, number>;
}

interface Row extends Partial<Measured> {
  role: string;
  lang: 'ro' | 'en';
  screen: string;
  path: string;
  url: string;
  width: number;
  shot?: string;
  errors: string[];
  console: string[];
}

/** Each measured screen, written as soon as it is measured (a run stopped halfway keeps its rows). */
function keepRow(row: Row) {
  mkdirSync(OUT, { recursive: true });
  appendFileSync(`${OUT}/rows-${test.info().workerIndex}.jsonl`, `${JSON.stringify(row)}\n`);
}

/** Every test stops measuring a little before its time limit, so the rest of the run still finishes. */
const BUDGET_MS = 30 * 60_000;

const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** Everything measured inside the page (runs in the browser). */
function measure(): Measured {
  const vw = window.innerWidth;
  const doc = document.documentElement;
  const out: Measured = {
    overflowX: doc.scrollWidth - vw,
    height: doc.scrollHeight,
    h1: (document.querySelector('main h1, h1')?.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80),
    h1Size: '',
    offscreen: [],
    textOverflow: [],
    clipped: [],
    ellipsis: [],
    smallTargets: [],
    tinyText: [],
    smallInputs: [],
    overlaps: [],
    brokenImages: [],
    buttonHeights: {},
  };
  const h1 = document.querySelector('main h1, h1');
  if (h1) {
    const cs = getComputedStyle(h1);
    out.h1Size = `${cs.fontSize}/${cs.fontWeight}`;
  }
  const label = (el: Element) => {
    const cls = typeof el.className === 'string' ? el.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.') : '';
    const text = ((el as HTMLElement).innerText ?? el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 48);
    const aria = el.getAttribute('aria-label');
    return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''} "${aria ?? text}"`;
  };
  const quiet = (el: Element) => !!el.closest('[aria-hidden="true"], [hidden], .visually-hidden, [inert], [data-tour-shade]');
  const visible = (r: DOMRect, cs: CSSStyleDeclaration) =>
    r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.01;
  /** Inside a box that scrolls or clips sideways (a carousel, a table that scrolls): not off the page. */
  const contained = (el: Element) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if (ox !== 'visible') return true;
    }
    return false;
  };
  const inFixed = (el: Element) => {
    for (let p: Element | null = el; p && p !== document.body; p = p.parentElement) {
      const pos = getComputedStyle(p).position;
      if (pos === 'fixed' || pos === 'sticky') return true;
    }
    return false;
  };
  const push = (list: string[], item: string) => {
    if (list.length < 25 && !list.includes(item)) list.push(item);
  };

  const all = Array.from(document.querySelectorAll('body *'));
  const reportedOff = new Set<Element>();
  for (const el of all) {
    if (el instanceof SVGElement && !(el instanceof SVGSVGElement)) continue;
    if (quiet(el)) continue;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (!visible(r, cs)) continue;

    // Off the page sideways (the topmost element only).
    if ((r.right > vw + 1 || r.left < -1) && !contained(el)) {
      let parentReported = false;
      for (let p = el.parentElement; p; p = p.parentElement) if (reportedOff.has(p)) parentReported = true;
      if (!parentReported) {
        reportedOff.add(el);
        push(out.offscreen, `${label(el)} [${Math.round(r.left)}…${Math.round(r.right)}]`);
      }
    }

    const ownText = Array.from(el.childNodes).filter((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '');
    if (ownText.length > 0 && !cs.display.startsWith('inline')) {
      // Text wider or taller than its box.
      const range = document.createRange();
      let left = Infinity;
      let right = -Infinity;
      let bottom = -Infinity;
      for (const n of ownText) {
        range.selectNode(n);
        for (const rr of Array.from(range.getClientRects())) {
          left = Math.min(left, rr.left);
          right = Math.max(right, rr.right);
          bottom = Math.max(bottom, rr.bottom);
        }
      }
      const padR = parseFloat(cs.paddingRight) || 0;
      const padL = parseFloat(cs.paddingLeft) || 0;
      const sideways = right > r.right - padR + 2 || left < r.left + padL - 2;
      const below = bottom > r.bottom + 2;
      if (cs.textOverflow === 'ellipsis' && (el as HTMLElement).scrollWidth > (el as HTMLElement).clientWidth + 1) {
        push(out.ellipsis, label(el));
      } else if ((sideways || below) && (cs.overflowX !== 'visible' || cs.overflowY !== 'visible')) {
        push(out.clipped, `${label(el)} ${Math.round(r.width)}×${Math.round(r.height)}`);
      } else if (sideways) {
        push(out.textOverflow, `${label(el)} box ${Math.round(r.left)}…${Math.round(r.right)} text ${Math.round(left)}…${Math.round(right)}`);
      }
      const size = parseFloat(cs.fontSize);
      if (size < 12) push(out.tinyText, `${cs.fontSize} ${label(el)}`);
    }
  }

  // Tap targets (CLAUDE.md §6.13) and the heights of buttons on the page.
  const targets = Array.from(
    document.querySelectorAll<HTMLElement>('button, a[href], [role="button"], select, input[type="checkbox"], input[type="radio"]'),
  );
  const boxes: { el: HTMLElement; r: DOMRect }[] = [];
  for (const el of targets) {
    if (quiet(el)) continue;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (!visible(r, cs)) continue;
    const inText = Array.from(el.parentElement?.childNodes ?? []).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '');
    const box = (el as HTMLInputElement).type === 'checkbox' || (el as HTMLInputElement).type === 'radio';
    if (box && (Number(cs.opacity) === 0 || el.closest('label'))) continue;
    if (!(cs.display.startsWith('inline') && inText) && (r.height < 43.5 || r.width < 43.5)) {
      push(out.smallTargets, `${label(el)} ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
    if (el.tagName === 'BUTTON' || (el.tagName === 'A' && !inText)) {
      const key = String(Math.round(r.height));
      out.buttonHeights[key] = (out.buttonHeights[key] ?? 0) + 1;
    }
    if (!inFixed(el)) boxes.push({ el, r });
  }
  // Two controls on top of each other.
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (w > 3 && h > 3) push(out.overlaps, `${label(a.el)} ⨯ ${label(b.el)} (${Math.round(w)}×${Math.round(h)})`);
    }
  }

  for (const el of Array.from(document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea'))) {
    if (quiet(el)) continue;
    const type = (el as HTMLInputElement).type;
    if (['checkbox', 'radio', 'hidden', 'file', 'range', 'color'].includes(type)) continue;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (!visible(r, cs)) continue;
    if (parseFloat(cs.fontSize) < 16) push(out.smallInputs, `${cs.fontSize} ${label(el)}`);
  }
  for (const img of Array.from(document.images)) {
    if (img.complete && img.naturalWidth === 0 && img.getBoundingClientRect().width > 0) push(out.brokenImages, img.currentSrc || img.src);
  }
  return out;
}

async function settle(page: Page) {
  await page
    .waitForFunction(() => document.readyState === 'complete' && !document.querySelector('[aria-busy="true"]'), null, { timeout: 6_000 })
    .catch(() => undefined);
  await page.waitForLoadState('networkidle', { timeout: 2_500 }).catch(() => undefined);
  await page.evaluate(async () => {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'))) el.dataset.shown = '';
    await document.fonts.ready;
  });
  await page.waitForTimeout(150);
}

const flagged = (m: Measured) =>
  m.overflowX > 0 || m.offscreen.length > 0 || m.textOverflow.length > 0 || m.clipped.length > 0 || m.overlaps.length > 0 || m.brokenImages.length > 0;

/**
 * English without touching the account: the profile the app reads says `en` (the saved language wins
 * after sign-in), so tests sharing a demo account at the same time keep their own language.
 */
async function english(page: Page) {
  await page.route(
    (url) => url.pathname.endsWith('/rest/v1/profiles'),
    async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const response = await route.fetch();
      let body = await response.text();
      try {
        const json = JSON.parse(body) as unknown;
        const fix = (o: unknown) => {
          if (o && typeof o === 'object' && 'lang' in o) (o as { lang: string }).lang = 'en';
        };
        if (Array.isArray(json)) json.forEach(fix);
        else fix(json);
        body = JSON.stringify(json);
      } catch {
        // Not JSON: as it came.
      }
      await route.fulfill({ response, body });
    },
  );
  await page.evaluate(() => localStorage.setItem('sh_lang', 'en'));
}

async function audit(page: Page, role: string, screens: Screen[], lang: 'ro' | 'en', started = Date.now()) {
  const consoleLines: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleLines.push(msg.text().slice(0, 200));
  });
  page.on('pageerror', (err) => consoleLines.push(`pageerror: ${err.message.slice(0, 200)}`));
  const widths = lang === 'ro' ? WIDTHS : EN_WIDTHS;
  for (const screen of screens) {
    if (lang === 'en' && screen.roOnly) continue;
    for (const width of widths) {
      if (screen.widths && !screen.widths.includes(width)) continue;
      consoleLines.length = 0;
      const row: Row = { role, lang, screen: screen.name, path: screen.path, url: '', width, errors: [], console: [] };
      if (Date.now() - started > BUDGET_MS) {
        row.errors.push('not measured: the test ran out of time');
        keepRow(row);
        continue;
      }
      try {
        await page.setViewportSize({ width, height: HEIGHT[width] ?? 900 });
        if (screen.before) await screen.before(page);
        await page.goto(screen.path, { waitUntil: 'domcontentloaded' });
        await settle(page);
        if (screen.prep) {
          await screen.prep(page);
          await settle(page);
        }
        const m = await page.evaluate(measure);
        Object.assign(row, m);
        const keep = lang === 'ro' ? ALWAYS_SHOT.has(width) || flagged(m) : flagged(m) || width === 390;
        if (keep) {
          const file = `shots/${lang}/${slug(role)}/${slug(screen.name)}__${width}.jpg`;
          mkdirSync(dirname(`${OUT}/${file}`), { recursive: true });
          await page.screenshot({ path: `${OUT}/${file}`, fullPage: FULL.has(width), type: 'jpeg', quality: 45, animations: 'disabled', caret: 'hide' });
          row.shot = file;
        }
      } catch (e) {
        row.errors.push(String(e).slice(0, 300));
      } finally {
        if (screen.after) await screen.after(page).catch(() => undefined);
      }
      row.url = new URL(page.url()).pathname + new URL(page.url()).search;
      row.console = [...new Set(consoleLines)].slice(0, 8);
      keepRow(row);
    }
  }
}

async function clickFirst(page: Page, selector: string) {
  const link = page.locator(`main ${selector}`).filter({ visible: true }).first();
  await link.click({ timeout: 8_000 });
  await page.waitForLoadState('domcontentloaded');
}

async function clickButton(page: Page, name: RegExp) {
  await page.getByRole('button', { name }).filter({ visible: true }).first().click({ timeout: 8_000 });
}

/** Another person in the same test: their own browser, the sign-in page in Romanian, no tour. */
async function personPage(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL, reducedMotion: 'reduce', timezoneId: 'Europe/Berlin' });
  await ctx.addInitScript(() => {
    localStorage.setItem('sh_onboarding_off', '1');
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
  return ctx.newPage();
}

async function signInWithCode(page: Page, email: string, password: string, secret: string) {
  await page.goto('/intra');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Parolă', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Intră în cont' }).click();
  const code = page.getByLabel(/^(Codul de 6 cifre|6-digit code)$/);
  for (let attempt = 0; attempt < 3; attempt++) {
    await code.fill(totp(secret));
    await page.getByRole('button', { name: /^(Confirmă|Confirm)$/ }).click();
    try {
      await expect(code).toHaveCount(0, { timeout: 6_000 });
      return;
    } catch {
      await page.waitForTimeout(31_000 - (Date.now() % 30_000));
    }
  }
}

async function runRole(page: Page, role: string, screens: Screen[]) {
  const started = Date.now();
  await audit(page, role, screens, 'ro', started);
  await english(page);
  await audit(page, role, screens, 'en', started);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.evaluate(() => localStorage.setItem('sh_lang', 'ro'));
}

const ids = {
  async shop(ownerEmailId: string) {
    const r = await serviceRest<{ id: string }[]>(`shops?owner_id=eq.${ownerEmailId}&select=id`, 'GET');
    return r[0]!.id;
  },
};

test.describe.configure({ mode: 'parallel' });

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      if (!localStorage.getItem('sh_lang')) localStorage.setItem('sh_lang', 'ro');
    }
  });
});

test.describe('A9 visual audit', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');

  test('visitor: public pages, sign-in, sign-up, legal, errors', async ({ page }) => {
    const atelier = await ids.shop('10000000-0000-4000-8000-000000000001');
    const screens: Screen[] = [
      { name: 'landing', path: '/' },
      { name: 'intra', path: '/intra' },
      { name: 'intra-erori', path: '/intra', roOnly: true, prep: async (p) => clickButton(p, /^Intră în cont$/) },
      { name: 'intra-focus', path: '/intra', roOnly: true, prep: async (p) => {
          for (let i = 0; i < 3; i++) await p.keyboard.press('Tab');
        } },
      { name: 'cont-nou', path: '/cont-nou' },
      { name: 'cont-nou-service', path: '/cont-nou', roOnly: true, prep: async (p) => {
          await p.getByLabel('Tip cont').selectOption('shop');
        } },
      { name: 'parola-uitata', path: '/parola-uitata' },
      { name: 'confirma-email', path: '/confirma-email' },
      { name: 'parola-noua', path: '/parola-noua' },
      { name: 'invitatie-invalida', path: '/invitatie/abc' },
      { name: 'atelier-public', path: `/atelier/${atelier}` },
      { name: 'link-programare-invalid', path: '/p/abc' },
      { name: 'legal-termeni', path: '/legal/termeni' },
      { name: 'legal-confidentialitate', path: '/legal/confidentialitate', roOnly: true },
      { name: 'legal-cookies', path: '/legal/cookies', roOnly: true },
      { name: 'verifica', path: '/verifica' },
      { name: '404', path: '/nu-exista' },
      { name: 'galerie-componente', path: '/dev/componente' },
      // The page templates (14 Nov 2026), each with data, loading, empty and failed; a list item open.
      ...(['lista', 'grila', 'formular', 'panou', 'citit'] as const).flatMap((t) =>
        ['', '?stare=incarcare', '?stare=gol', '?stare=eroare'].map((q) => ({
          name: `sablon-${t}${q ? `-${q.slice(7)}` : ''}`,
          path: `/dev/componente/sabloane/${t}${q}`,
          roOnly: q !== '',
        })),
      ),
      { name: 'sablon-lista-incheiate', path: '/dev/componente/sabloane/lista?fila=incheiate' },
      { name: 'sablon-lista-detaliu', path: '/dev/componente/sabloane/lista?id=b1' },
      { name: 'flota-previzualizare', path: '/dev/flota' },
    ];
    await runRole(page, 'visitor', screens);
  });

  for (const half of [0, 1] as const) test(`client: Andrei (seed), part ${half + 1}`, async ({ page }) => {
    const clientId = '20000000-0000-4000-8000-000000000001';
    const atelier = await ids.shop('10000000-0000-4000-8000-000000000001');
    const cars = await serviceRest<{ id: string }[]>(`cars?owner_id=eq.${clientId}&select=id&order=created_at`, 'GET');
    const bookings = await serviceRest<{ id: string; status: string }[]>(`bookings?client_id=eq.${clientId}&select=id,status&order=created_at.desc`, 'GET');
    const threads = await serviceRest<{ id: string }[]>(`threads?client_id=eq.${clientId}&select=id&limit=1`, 'GET');
    const articles = await serviceRest<{ slug: string }[]>('help_articles?status=eq.published&audience=cs.{client}&select=slug&limit=1', 'GET').catch(() => []);
    const categories = await serviceRest<{ slug: string }[]>('help_categories?active=eq.true&audience=cs.{client}&select=slug&limit=1', 'GET').catch(() => []);
    if (half === 1) await rpcAs(SEED.client, 'create_support_request', {
      p_category: 'account',
      p_title: 'Nu pot schimba numărul de telefon',
      p_body: 'După schimbarea telefonului nu primesc codul prin SMS.',
      p_booking_ref: null,
      p_request_id: randomUUID(),
    }, SEED_PASSWORD).catch(() => undefined);
    const car = cars[0]?.id ?? 'x';
    const done = bookings.find((b) => b.status === 'completed')?.id ?? bookings[0]?.id ?? 'x';
    await signIn(page, SEED.client, SEED_PASSWORD);
    await expect(page).toHaveURL(/\/c\/cauta/, { timeout: 20_000 });
    const screens: Screen[] = [
      { name: 'cauta', path: '/c/cauta' },
      { name: 'cauta-filtre', path: '/c/cauta', roOnly: true, prep: async (p) => clickButton(p, /^Filtre/) },
      { name: 'service', path: `/c/service/${atelier}` },
      { name: 'programare-pas1', path: `/c/service/${atelier}/programare` },
      { name: 'garaj', path: '/c/garaj' },
      { name: 'garaj-nou', path: '/c/garaj/nou' },
      { name: 'garaj-masina', path: `/c/garaj/${car}` },
      { name: 'garaj-istoric', path: `/c/garaj/${car}/istoric` },
      { name: 'garaj-raport', path: `/c/garaj/${car}/raport` },
      { name: 'programari', path: '/c/programari' },
      { name: 'programari-eroare', path: '/c/programari', roOnly: true, widths: [390, 1440],
        before: async (p) => {
          await p.route('**/rest/v1/rpc/**', (r) => r.abort());
        }, after: async (p) => p.unrouteAll({ behavior: 'ignoreErrors' }) },
      { name: 'programare-istoric', path: `/c/programari/${done}/istoric` },
      { name: 'mesaje', path: '/c/mesaje' },
      { name: 'conversatie', path: `/c/mesaje/${threads[0]?.id ?? 'x'}` },
      { name: 'mesaje-echipa', path: '/c/mesaje/echipa' },
      { name: 'cont', path: '/c/cont' },
      { name: 'cont-deconectare', path: '/c/cont', roOnly: true, prep: async (p) => {
          // In Cont on a phone or tablet, in the sidebar from 1024 px.
          await p.getByRole('button', { name: /^Deconectare$/ }).filter({ visible: true }).first().click();
        } },
      { name: 'favorite', path: '/c/cont/favorite' },
      { name: 'istoric-alege', path: '/c/cont/istoric' },
      { name: 'rapoarte', path: '/c/cont/rapoarte' },
      { name: 'notificari', path: '/c/cont/notificari' },
      { name: 'firma', path: '/c/cont/firma' },
      { name: 'firme', path: '/c/cont/firme' },
      { name: 'ajutor', path: '/c/cont/ajutor' },
      { name: 'ajutor-categorie', path: `/c/cont/ajutor/categorie/${categories[0]?.slug ?? 'x'}` },
      { name: 'ajutor-articol', path: `/c/cont/ajutor/articol/${articles[0]?.slug ?? 'x'}` },
      { name: 'solicitari', path: '/c/cont/ajutor/solicitari' },
      { name: 'solicitare-noua', path: '/c/cont/ajutor/solicitari/noua' },
      { name: 'solicitare', path: '/c/cont/ajutor/solicitari', prep: async (p) => clickFirst(p, 'a[href^="/c/cont/ajutor/solicitari/"]:not([href$="/noua"])') },
      { name: 'sugestii', path: '/c/cont/sugestii' },
      { name: 'cont-legal', path: '/c/cont/legal/termeni', roOnly: true },
      { name: 'necunoscut', path: '/c/nu-exista', roOnly: true },
    ];
    const cut = screens.findIndex((x) => x.name === 'mesaje');
    await runRole(page, 'client', half === 0 ? screens.slice(0, cut) : screens.slice(cut));
  });

  test('new client: empty states', async ({ page }) => {
    const client = await createUser('client');
    await signIn(page, client, PASSWORD);
    await expect(page).toHaveURL(/\/c\/cauta/, { timeout: 20_000 });
    await audit(page, 'client-nou', [
      { name: 'garaj-gol', path: '/c/garaj' },
      { name: 'programari-gol', path: '/c/programari' },
      { name: 'mesaje-gol', path: '/c/mesaje' },
      { name: 'favorite-gol', path: '/c/cont/favorite' },
      { name: 'rapoarte-gol', path: '/c/cont/rapoarte' },
      { name: 'solicitari-gol', path: '/c/cont/ajutor/solicitari' },
      { name: 'cont-nou-client', path: '/c/cont' },
    ], 'ro');
  });

  test('new shop: empty states, first steps', async ({ browser }) => {
    const shopPage = await personPage(browser);
    const shop = await createUser('shop');
    await signIn(shopPage, shop, PASSWORD);
    await expect(shopPage).toHaveURL(/\/s\/panou/, { timeout: 20_000 });
    await audit(shopPage, 'service-nou', [
      { name: 'panou-nou', path: '/s/panou' },
      { name: 'programari-gol', path: '/s/programari' },
      { name: 'istoric-gol', path: '/s/istoric' },
      { name: 'mesaje-gol', path: '/s/mesaje' },
      { name: 'recenzii-gol', path: '/s/cont/recenzii' },
      { name: 'rapoarte-gol', path: '/s/cont/rapoarte' },
      { name: 'abonament-nou', path: '/s/cont/abonament' },
      { name: 'cont-nou-service', path: '/s/cont' },
    ], 'ro');
  });

  for (const who of ['admin', 'members'] as const) test(`company (fleet): ${who}`, async ({ page, browser }) => {
    const f = await fleetSetup();
    const base = `/c/firme/${f.company}`;
    const s = (section: string, extra = '') => `${base}?sectiune=${section}${extra}`;
    if (who === 'admin') {
      await signIn(page, f.admin, PASSWORD);
      await expect(page).toHaveURL(/\/c\/cauta/, { timeout: 20_000 });
      await runRole(page, 'firma-admin', [
        { name: 'firme', path: '/c/cont/firme' },
        { name: 'firma-detalii', path: `/c/cont/firme/${f.company}` },
        { name: 'panou', path: s('panou') },
        { name: 'vehicule', path: s('vehicule') },
        { name: 'vehicul', path: s('vehicul', `&vehicul=${f.vehicle}`) },
        { name: 'programari', path: s('programari') },
        { name: 'costuri', path: s('costuri') },
        { name: 'rapoarte', path: s('rapoarte') },
        { name: 'membri', path: s('membri') },
        { name: 'abonament', path: s('abonament') },
        { name: 'cont-firma', path: s('cont') },
      ]);
      return;
    }
    for (const [role, email, sections] of [
      ['firma-manager', f.manager, ['panou', 'vehicule', 'membri']],
      ['firma-sofer', f.driver, ['panou', 'vehicule', 'programari']],
      ['firma-contabil', f.accountant, ['panou', 'costuri', 'rapoarte']],
    ] as const) {
      const p = await personPage(browser);
      await signIn(p, email, PASSWORD);
      await expect(p).toHaveURL(/\/c\/cauta/, { timeout: 20_000 });
      await audit(p, role, sections.map((x) => ({ name: x, path: s(x) })), 'ro');
      await p.context().close();
    }
  });

  for (const half of [0, 1] as const) test(`shop: Atelier Demo (seed), part ${half + 1}`, async ({ page }) => {
    const ownerId = '10000000-0000-4000-8000-000000000001';
    const atelier = await ids.shop(ownerId);
    const bookings = await serviceRest<{ id: string; status: string }[]>(`bookings?shop_id=eq.${atelier}&select=id,status&order=created_at.desc`, 'GET');
    const by = (...st: string[]) => bookings.find((b) => st.includes(b.status))?.id ?? bookings[0]?.id ?? 'x';
    const threads = await serviceRest<{ id: string }[]>(`threads?shop_id=eq.${atelier}&select=id&limit=1`, 'GET');
    await signIn(page, SEED.shop, SEED_PASSWORD);
    await expect(page).toHaveURL(/\/s\/panou/, { timeout: 20_000 });
    const screens: Screen[] = [
      { name: 'panou', path: '/s/panou' },
      { name: 'programari', path: '/s/programari' },
      { name: 'programari-deschise', path: '/s/programari', roOnly: true, prep: async (p) => {
          const closed = p.locator('main button[aria-controls^="booking-"][aria-expanded="false"]');
          for (let i = 0; i < 4 && (await closed.count()) > 0; i++) await closed.first().click();
        } },
      { name: 'programari-mai-multe', path: '/s/programari', roOnly: true, prep: async (p) => clickButton(p, /^Mai multe/) },
      { name: 'programare-noua', path: '/s/programari/nou' },
      { name: 'import', path: '/s/programari/import' },
      { name: 'deviz-editor', path: `/s/programari/deviz/${by('in_inspection')}` },
      { name: 'deviz-indisponibil', path: `/s/programari/deviz/${by('confirmed')}`, roOnly: true },
      { name: 'preluare', path: `/s/programari/preluare/${by('confirmed', 'in_inspection')}` },
      { name: 'fisa-vehicul', path: `/s/istoric/fisa/${by('completed')}` },
      { name: 'istoric', path: '/s/istoric' },
      { name: 'istoric-deschis', path: '/s/istoric', roOnly: true, prep: async (p) => {
          await p.locator('main button[aria-controls]').filter({ visible: true }).first().click();
        } },
      { name: 'mesaje', path: '/s/mesaje' },
      { name: 'conversatie', path: `/s/mesaje/${threads[0]?.id ?? 'x'}` },
      { name: 'cont', path: '/s/cont' },
      { name: 'recenzii', path: '/s/cont/recenzii' },
      { name: 'link', path: '/s/cont/link' },
      { name: 'abonament', path: '/s/cont/abonament' },
      { name: 'rapoarte', path: '/s/cont/rapoarte' },
      { name: 'setari', path: '/s/cont/setari' },
      { name: 'setari-profil', path: '/s/cont/setari/profil' },
      { name: 'setari-program', path: '/s/cont/setari/program' },
      { name: 'setari-reguli', path: '/s/cont/setari/reguli' },
      { name: 'setari-servicii', path: '/s/cont/setari/servicii' },
      { name: 'setari-vitrina', path: '/s/cont/setari/vitrina' },
      { name: 'setari-devize', path: '/s/cont/setari/devize' },
      { name: 'setari-facturare', path: '/s/cont/setari/facturare' },
      { name: 'setari-personal', path: '/s/cont/setari/personal' },
      { name: 'notificari', path: '/s/cont/notificari' },
      { name: 'ajutor', path: '/s/cont/ajutor' },
      { name: 'solicitare-noua', path: '/s/cont/ajutor/solicitari/noua' },
      { name: 'sugestii', path: '/s/cont/sugestii' },
    ];
    const cut = screens.findIndex((x) => x.name === 'cont');
    await runRole(page, 'service', half === 0 ? screens.slice(0, cut) : screens.slice(cut));
  });

  test('shop colleague (staff of Atelier Demo)', async ({ browser }) => {
    const atelier = await ids.shop('10000000-0000-4000-8000-000000000001');
    const colleague = await createUser('client', { name: 'Coleg Atelier' });
    const colleagueId = await userIdOf(colleague);
    await serviceRest(`profiles?id=eq.${colleagueId}`, 'PATCH', { role: 'shop' });
    await serviceRest('shop_staff', 'POST', { shop_id: atelier, user_id: colleagueId, invited_email: colleague, role: 'staff', accepted_at: new Date().toISOString() });
    const p = await personPage(browser);
    await signIn(p, colleague, PASSWORD);
    await expect(p).toHaveURL(/\/s\/panou/, { timeout: 20_000 });
    await audit(p, 'service-coleg', [
      { name: 'panou', path: '/s/panou' },
      { name: 'programari', path: '/s/programari' },
      { name: 'cont', path: '/s/cont' },
      { name: 'setari', path: '/s/cont/setari' },
      { name: 'setari-facturare', path: '/s/cont/setari/facturare' },
      { name: 'abonament', path: '/s/cont/abonament' },
    ], 'ro');
  });

  test('shop quote editor (a booking in inspection)', async ({ page }) => {
    const atelier = await ids.shop('10000000-0000-4000-8000-000000000001');
    const open = await serviceRest<{ id: string }[]>(`bookings?shop_id=eq.${atelier}&status=eq.in_inspection&select=id&limit=1`, 'GET');
    await signIn(page, SEED.shop, SEED_PASSWORD);
    await expect(page).toHaveURL(/\/s\/panou/, { timeout: 20_000 });
    await runRole(page, 'service', [{ name: 'deviz-editor', path: `/s/programari/deviz/${open[0]?.id ?? 'x'}` }]);
  });

  test('client logout confirmation', async ({ page }) => {
    await signIn(page, SEED.client, SEED_PASSWORD);
    await expect(page).toHaveURL(/\/c\/cauta/, { timeout: 20_000 });
    await audit(page, 'client', [
      { name: 'cont-deconectare', path: '/c/cont', prep: async (p) => {
          // In Cont on a phone or tablet, in the sidebar from 1024 px.
          await p.getByRole('button', { name: /^Deconectare$/ }).filter({ visible: true }).first().click();
        } },
    ], 'ro');
  });

  test('support agent (seed)', async ({ page }) => {
    const client = await createUser('client');
    await rpcAs(client, 'create_support_request', {
      p_category: 'booking',
      p_title: 'Programarea nu apare în listă',
      p_body: 'Am trimis cererea ieri și nu o văd la Programări.',
      p_booking_ref: null,
      p_request_id: randomUUID(),
    }).catch(() => undefined);
    const procs = await serviceRest<{ id: string }[]>('procedures?select=id&limit=1', 'GET').catch(() => []);
    const articles = await serviceRest<{ slug: string }[]>('help_articles?status=eq.published&select=slug&limit=1', 'GET').catch(() => []);
    const categories = await serviceRest<{ slug: string }[]>('help_categories?active=eq.true&select=slug&limit=1', 'GET').catch(() => []);
    await signInWithCode(page, SEED_SUPPORT.email, SEED_PASSWORD, SEED_SUPPORT.secret);
    const screens: Screen[] = [
      { name: 'solicitari', path: '/suport/solicitari' },
      { name: 'solicitare', path: '/suport/solicitari', prep: async (p) => clickFirst(p, 'a[href^="/suport/solicitari/"]') },
      { name: 'cautare', path: '/suport/cautare' },
      { name: 'cautare-rezultat', path: '/suport/cautare', roOnly: true, prep: async (p) => {
          await p.locator('main input[type="search"]').first().fill('client@service-hub.test');
          await p.keyboard.press('Enter');
        } },
      { name: 'ajutor', path: '/suport/ajutor' },
      { name: 'ajutor-categorie', path: `/suport/ajutor/categorie/${categories[0]?.slug ?? 'x'}` },
      { name: 'ajutor-articol', path: `/suport/ajutor/articol/${articles[0]?.slug ?? 'x'}` },
      { name: 'proceduri', path: '/suport/proceduri' },
      { name: 'procedura', path: `/suport/proceduri/${procs[0]?.id ?? 'x'}` },
      { name: 'procedura-noua', path: '/suport/proceduri/nou' },
      { name: 'responsabili', path: '/suport/proceduri/responsabili' },
      { name: 'sugestii-de-verificat', path: '/suport/sugestii-de-verificat' },
      { name: 'cont', path: '/suport/cont' },
    ];
    await runRole(page, 'suport', screens);
  });

  for (const part of [0, 1, 2] as const) test(`platform admin (seed), part ${part + 1}`, async ({ page }) => {
    const procs = await serviceRest<{ id: string }[]>('procedures?select=id&limit=1', 'GET').catch(() => []);
    await signIn(page, SEED.admin, SEED_PASSWORD);
    await expect(page).toHaveURL(/\/admin\//, { timeout: 30_000 });
    const a = '/admin';
    const screens: Screen[] = [
      { name: 'panou', path: `${a}/panou` },
      { name: 'parteneri', path: `${a}/parteneri` },
      { name: 'activitate', path: `${a}/activitate` },
      { name: 'suport', path: `${a}/suport` },
      { name: 'platforma', path: `${a}/platforma` },
      { name: 'clienti', path: `${a}/parteneri/clienti` },
      { name: 'client', path: `${a}/parteneri/clienti`, prep: async (p) => clickFirst(p, 'a[href^="/admin/parteneri/clienti/"]') },
      { name: 'service-uri', path: `${a}/parteneri/service-uri` },
      { name: 'service', path: `${a}/parteneri/service-uri`, prep: async (p) => clickFirst(p, 'a[href^="/admin/parteneri/service-uri/"]') },
      { name: 'firme', path: `${a}/parteneri/firme` },
      { name: 'anaf', path: `${a}/parteneri/anaf` },
      { name: 'duplicate', path: `${a}/parteneri/duplicate` },
      { name: 'programari', path: `${a}/activitate/programari` },
      { name: 'programare', path: `${a}/activitate/programari`, prep: async (p) => clickFirst(p, 'a[href^="/admin/activitate/programari/"]') },
      { name: 'moderare', path: `${a}/activitate/moderare` },
      { name: 'contestatii', path: `${a}/activitate/contestatii` },
      { name: 'abonamente', path: `${a}/activitate/abonamente` },
      { name: 'rapoarte', path: `${a}/activitate/rapoarte` },
      { name: 'export', path: `${a}/activitate/export` },
      { name: 'solicitari', path: `${a}/suport/solicitari` },
      { name: 'solicitare', path: `${a}/suport/solicitari`, prep: async (p) => clickFirst(p, 'a[href^="/admin/suport/solicitari/"]') },
      { name: 'pastrare-legala', path: `${a}/suport/pastrare-legala` },
      { name: 'sugestii-de-verificat', path: `${a}/suport/sugestii-de-verificat` },
      { name: 'centrul-de-ajutor', path: `${a}/suport/centrul-de-ajutor` },
      { name: 'articol-editare', path: `${a}/suport/centrul-de-ajutor`, prep: async (p) => clickFirst(p, 'a[href*="/centrul-de-ajutor/articol/"]') },
      { name: 'proceduri', path: `${a}/suport/proceduri` },
      { name: 'procedura', path: `${a}/suport/proceduri/${procs[0]?.id ?? 'x'}` },
      { name: 'procedura-editare', path: `${a}/suport/proceduri/${procs[0]?.id ?? 'x'}/editare` },
      { name: 'responsabili', path: `${a}/suport/proceduri/responsabili` },
      { name: 'setari', path: `${a}/platforma/setari` },
      { name: 'texte', path: `${a}/platforma/texte` },
      { name: 'anunturi', path: `${a}/platforma/anunturi` },
      { name: 'zone', path: `${a}/platforma/zone` },
      { name: 'catalog', path: `${a}/platforma/catalog` },
      { name: 'jurnal', path: `${a}/platforma/jurnal` },
      { name: 'notificari-flota', path: `${a}/platforma/notificari-flota` },
      { name: 'echipa', path: `${a}/platforma/echipa` },
      { name: 'retentie', path: `${a}/platforma/retentie` },
      { name: 'securitate', path: `${a}/platforma/securitate` },
      { name: 'administratori', path: `${a}/platforma/administratori` },
      { name: 'cont', path: `${a}/cont` },
    ];
    const a1 = screens.findIndex((x) => x.name === 'programari');
    const a2 = screens.findIndex((x) => x.name === 'proceduri');
    await runRole(page, 'admin', [screens.slice(0, a1), screens.slice(a1, a2), screens.slice(a2)][part]!);
  });
});
