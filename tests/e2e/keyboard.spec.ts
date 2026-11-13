import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { newPage } from './agent';
import { fleetSetup } from './fleet-support';
import { BACKEND, PASSWORD, SEED, SEED_PASSWORD, createBookableShop, createUser, revokeSessions, rpcAs, serviceRest, signIn } from './support';

// The phone's keyboard over the app's forms (Eduard, 11 Nov 2026: on the iPhone the bottom bar
// covered „Solicitare nouă” and its button). A browser here has no real keyboard, so it is played
// two ways, at 320, 375, 390 and 430 px wide (the heights Safari leaves on those iPhones):
// · iPhone (Safari): the page keeps its height, only the visible part (visualViewport) gets shorter
//   by the keyboard's height, and a grey block stands where the keyboard covers the page;
// · Android: the page itself gets shorter (the Android app, Chrome with resizes-content).
// For every form: each field (the first, the last, every text area and drop-down list) gets the
// focus with the keyboard open — the bottom bar steps aside, the field is seen, nothing sticks over
// it; the keyboard closes — the bar is back and the page has no gap; the main button is reached and
// nothing covers it, with and without the keyboard; a form with errors keeps its fields seen.
// Safari also moves what is seen down the page by itself (visualViewport.offsetTop): played with
// __setPan (Eduard, 13 Nov 2026: the header slid away and the field stayed under the keyboard).
// This does not replace a real iPhone: it passed while his iPhone still failed, because Safari
// answers getBoundingClientRect from the top of what is seen and Chrome from the page's own top.

const SIZES = [
  { width: 320, height: 454, keyboard: 260 },
  { width: 375, height: 553, keyboard: 290 },
  { width: 390, height: 664, keyboard: 336 },
  { width: 430, height: 746, keyboard: 346 },
] as const;
type Size = (typeof SIZES)[number];
type Mode = 'iphone' | 'android';

const name = () => test.info().project.name;
/** Pictures and the list of checks (outside test-results, which each run empties). */
const OUT = process.env.KB_OUT ?? 'test-results/keyboard';
const stamp = () => Math.random().toString(36).slice(2, 8);
const h1 = (page: Page) => page.getByRole('heading', { level: 1 }).first();

/** The language, and the iPhone's keyboard played in the page (see the top of this file). */
async function installKeyboard(context: BrowserContext) {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
    // The iPhone's keyboard: the visible part shrinks, the page does not; a grey block where it covers.
    const w = window as unknown as { __kb: number; __pan: number; __setKeyboard: (h: number) => void; __setPan: (p: number) => void };
    w.__kb = 0;
    w.__pan = 0;
    const vv = window.visualViewport;
    if (vv) {
      const height = Object.getOwnPropertyDescriptor(VisualViewport.prototype, 'height')!.get!;
      const offsetTop = Object.getOwnPropertyDescriptor(VisualViewport.prototype, 'offsetTop')!.get!;
      Object.defineProperty(vv, 'height', { configurable: true, get: () => height.call(vv) - w.__kb });
      Object.defineProperty(vv, 'offsetTop', { configurable: true, get: () => offsetTop.call(vv) + w.__pan });
      // Chrome answers positions from the page's own top: what is seen starts offsetTop lower in the
      // page (pageTop = scrollY + offsetTop). Safari answers from the top of what is seen instead
      // (measured on Eduard's iPhone); that case is in tests/unit/keyboard.test.ts, with his numbers.
      const pageTop = Object.getOwnPropertyDescriptor(VisualViewport.prototype, 'pageTop')!.get!;
      Object.defineProperty(vv, 'pageTop', { configurable: true, get: () => pageTop.call(vv) + w.__pan });
    }
    // Safari moving what is seen down the page by `p` px (only while the keyboard is open).
    w.__setPan = (p: number) => {
      w.__pan = p;
      const el = document.getElementById('__keyboard');
      if (el) el.style.bottom = `${-p}px`;
      vv?.dispatchEvent(new Event('scroll'));
    };
    w.__setKeyboard = (h: number) => {
      w.__kb = h;
      let el = document.getElementById('__keyboard');
      if (!el) {
        el = document.createElement('div');
        el.id = '__keyboard';
        el.textContent = 'Tastatura iPhone (simulată)';
        Object.assign(el.style, {
          position: 'fixed',
          left: '0',
          right: '0',
          bottom: '0',
          zIndex: '2147483647',
          pointerEvents: 'none',
          background: '#3a3d44',
          color: '#c9ccd2',
          font: '14px sans-serif',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        });
        document.documentElement.appendChild(el);
      }
      el.style.height = `${h}px`;
      el.style.visibility = h ? 'visible' : 'hidden';
      if (!h) w.__pan = 0;
      vv?.dispatchEvent(new Event('resize'));
    };
  });
}

test.beforeEach(async ({ context }) => {
  await installKeyboard(context);
});

async function setSize(page: Page, s: Size) {
  await page.setViewportSize({ width: s.width, height: s.height });
}

async function openKeyboard(page: Page, s: Size, mode: Mode) {
  if (mode === 'iphone') await page.evaluate((h) => (window as unknown as { __setKeyboard: (h: number) => void }).__setKeyboard(h), s.keyboard);
  else await page.setViewportSize({ width: s.width, height: s.height - s.keyboard });
  await page.waitForTimeout(350); // the app moves the field after the keyboard settles (120 ms)
}

async function closeKeyboard(page: Page, s: Size, mode: Mode) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  if (mode === 'iphone') await page.evaluate(() => (window as unknown as { __setKeyboard: (h: number) => void }).__setKeyboard(0));
  else await setSize(page, s);
  await page.waitForTimeout(200);
}

/** What the person sees: the visible part, below the header and „‹ Înapoi” while they are on screen. */
async function band(page: Page) {
  return page.evaluate(() => {
    const vv = window.visualViewport!;
    let top = vv.offsetTop;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('header, [data-back-bar]'))) {
      const pos = getComputedStyle(el).position;
      const r = el.getBoundingClientRect();
      if ((pos === 'sticky' || pos === 'fixed') && r.height > 0 && r.bottom > top && r.top <= top + 1) top = r.bottom;
    }
    let bottom = vv.offsetTop + vv.height;
    if (!document.documentElement.hasAttribute('data-keyboard')) {
      const r = document.querySelector<HTMLElement>('nav[data-fixed-bottom]')?.getBoundingClientRect();
      if (r && r.height > 0) bottom = Math.min(bottom, r.top);
    }
    return { top, bottom, atEnd: window.scrollY >= document.documentElement.scrollHeight - window.innerHeight - 1 };
  });
}

/** What is on top at a point of `target`: '' when it is the target itself (or inside it), else what covers it. */
async function coveredBy(target: Locator): Promise<string> {
  return target.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const x = r.left + Math.min(r.width / 2, 24);
    const y = r.top + Math.min(r.height / 2, 18);
    const hit = document.elementFromPoint(x, y);
    if (!hit) return `nothing at ${Math.round(x)},${Math.round(y)} (outside the window ${window.innerWidth}×${window.innerHeight})`;
    if (hit === el || el.contains(hit) || hit.contains(el) || (el as HTMLInputElement).labels?.[0]?.contains(hit) === true) return '';
    return `${hit.tagName.toLowerCase()}.${String(hit.className).slice(0, 60)} «${(hit.textContent ?? '').trim().slice(0, 40)}»`;
  });
}

/** Something fixed or sticky (other than the header) over the visible part: it would hide what is typed. */
async function stuckOver(page: Page) {
  return page.evaluate(() => {
    const vv = window.visualViewport!;
    const top = vv.offsetTop + 1;
    const bottom = vv.offsetTop + vv.height - 1;
    const found: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      if (el.id === '__keyboard' || el.closest('header')) continue;
      const pos = getComputedStyle(el).position;
      if (pos !== 'fixed' && pos !== 'sticky') continue;
      const r = el.getBoundingClientRect();
      if (r.height === 0 || r.width === 0 || getComputedStyle(el).visibility === 'hidden') continue;
      // A sticky element sitting where it is in the page is fine; one held against the bottom edge is not.
      const heldAtBottom = Math.abs(r.bottom - (window.innerHeight - (parseFloat(getComputedStyle(el).bottom) || 0))) < 2;
      if (r.bottom > top && r.top < bottom && (pos === 'fixed' || heldAtBottom) && r.top > (top + bottom) / 2) {
        found.push(`${el.tagName.toLowerCase()}.${el.className}`.slice(0, 80));
      }
    }
    return found;
  });
}

async function fieldsOf(page: Page): Promise<Locator[]> {
  const scope = (await page.locator('main').count()) > 0 ? page.locator('main') : page.locator('body');
  const all = scope.locator(
    'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=button]):not([type=submit]):not([type=range]):not([disabled]), textarea:not([disabled]), select:not([disabled])',
  );
  const list: Locator[] = [];
  const n = await all.count();
  for (let i = 0; i < n; i++) if (await all.nth(i).isVisible()) list.push(all.nth(i));
  // The first, the last, every text area and drop-down list (at most 8).
  const picked = new Set<number>([0, list.length - 1]);
  for (let i = 0; i < list.length; i++) {
    const tag = await list[i]!.evaluate((el) => el.tagName);
    if (tag !== 'INPUT') picked.add(i);
  }
  return [...picked]
    .filter((i) => i >= 0 && i < list.length)
    .sort((a, b) => a - b)
    .slice(0, 8)
    .map((i) => list[i]!);
}

interface Form {
  label: string;
  open: (page: Page) => Promise<void>;
  submit?: (page: Page) => Locator;
  /** Shows the form's validation errors (without sending anything). */
  errors?: (page: Page) => Promise<void>;
}

async function checkForm(page: Page, form: Form, results: string[]) {
  for (const s of SIZES) {
    await setSize(page, s);
    await form.open(page);
    for (const mode of ['iphone', 'android'] as const) {
      const where = `${form.label} @${s.width} ${mode}`;
      const fields = await fieldsOf(page);
      expect(fields.length, `${where}: fields`).toBeGreaterThan(0);
      const gapBefore = await page.evaluate(() => document.documentElement.scrollHeight);
      for (const field of fields) {
        await field.focus();
        await openKeyboard(page, s, mode);
        const what = `${where} ${await field.evaluate((el) => `${el.tagName.toLowerCase()} ${(el as HTMLInputElement).labels?.[0]?.textContent?.trim() ?? (el as HTMLInputElement).name ?? ''}`)}`;
        await expect(page.locator('html'), `${what}: keyboard seen`).toHaveAttribute('data-keyboard', '');
        const bar = page.locator('nav[aria-label="Navigare principală"]').last();
        if ((await bar.count()) > 0 && (await page.locator('header').count()) > 0) {
          await expect(bar, `${what}: the bottom bar steps aside`).toBeHidden();
        }
        const b = await band(page);
        const box = (await field.boundingBox())!;
        expect(box.y, `${what}: below the top`).toBeGreaterThanOrEqual(b.top - 1);
        // A text area taller than what is seen shows its top; anything else is seen whole.
        const below = box.height < b.bottom - b.top - 32 ? box.y + box.height > b.bottom + 1 : box.y > b.bottom - 40;
        // Also at the end of a short page (Eduard, 13 Nov 2026: this was left to Safari, which moved
        // the header away and left the field under the keyboard): the page keeps room to scroll.
        expect(below, `${what}: above the keyboard${b.atEnd ? ' (end of the page)' : ''}`).toBe(false);
        expect(await coveredBy(field), `${what}: nothing over it`).toBe('');
        expect(await stuckOver(page), `${what}: nothing held over the visible part`).toEqual([]);
        await closeKeyboard(page, s, mode);
      }
      // Keyboard closed: the bar is back, the page holds no space left by the keyboard.
      await expect(page.locator('html'), `${where}: keyboard gone`).not.toHaveAttribute('data-keyboard', '');
      const navBottom = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-bottom')) || 0);
      if ((await page.locator('header').count()) > 0 && s.width < 1024) expect(navBottom, `${where}: the bar is back`).toBeGreaterThan(40);
      expect(Math.abs((await page.evaluate(() => document.documentElement.scrollHeight)) - gapBefore), `${where}: no gap`).toBeLessThanOrEqual(2);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${where}: no sideways scroll`).toBe(true);

      if (form.submit) {
        const submit = form.submit(page);
        // Without the keyboard: at the end of the page, seen whole and above the bar.
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(150);
        await submit.scrollIntoViewIfNeeded({ timeout: 15_000 });
        const nb = await band(page);
        const sb = (await submit.boundingBox())!;
        expect(sb.y + sb.height, `${where}: the button above the bottom bar`).toBeLessThanOrEqual(nb.bottom + 1);
        expect(await coveredBy(submit), `${where}: nothing over the button`).toBe('');
        // With the keyboard open on the last field: the button is reached by scrolling, nothing holds it.
        const last = fields[fields.length - 1]!;
        await last.focus();
        await openKeyboard(page, s, mode);
        await submit.evaluate((el) => {
          window.dispatchEvent(new Event('touchmove')); // a finger scrolls to the button, not the browser
          el.scrollIntoView({ block: 'start' });
        });
        await page.waitForTimeout(150);
        const kb = await band(page);
        const kbBox = (await submit.boundingBox())!;
        expect(
          await submit.evaluate((el) => getComputedStyle(el.closest('[data-fixed-bottom]') ?? el).position),
          `${where}: keyboard open, the button is in the page (not held behind the keyboard)`,
        ).not.toBe('sticky');
        expect(kbBox.y + kbBox.height, `${where}: keyboard open, the button reached`).toBeLessThanOrEqual(kb.bottom + 1);
        expect(kbBox.y, `${where}: keyboard open, the button below the top bars`).toBeGreaterThanOrEqual(kb.top - 1);
        expect(await coveredBy(submit), `${where}: keyboard open, nothing over the button`).toBe('');
        await closeKeyboard(page, s, mode);
      }
      results.push(`${where}: ok (${fields.length} fields)`);
    }
    if (form.errors) {
      await form.errors(page);
      const invalid = page.locator('[aria-invalid="true"]');
      expect(await invalid.count(), `${form.label} @${s.width}: errors shown`).toBeGreaterThan(0);
      const first = invalid.first();
      await first.focus();
      await openKeyboard(page, s, 'iphone');
      const b = await band(page);
      const box = (await first.boundingBox())!;
      expect(box.y, `${form.label} @${s.width}: the field with an error is seen`).toBeGreaterThanOrEqual(b.top - 1);
      expect(Math.min(box.y + box.height, box.y + 60), `${form.label} @${s.width}: above the keyboard`).toBeLessThanOrEqual(b.bottom + 1);
      await closeKeyboard(page, s, 'iphone');
      results.push(`${form.label} @${s.width}: errors ok`);
    }
  }
}

/** Each checked form, size and keyboard, written down for the PR (keyboard-results.txt). */
function report(results: string[]) {
  mkdirSync(OUT, { recursive: true });
  appendFileSync(`${OUT}/keyboard-results.txt`, `${results.join('\n')}\n`);
}

async function shot(page: Page, file: string) {
  await page.screenshot({ path: `${OUT}/${file}.png` });
}

/** Before/after pictures of „Solicitare nouă”: the description typed in with the keyboard open. */
async function pictures(page: Page, open: (page: Page) => Promise<void>, prefix: string) {
  for (const s of SIZES) {
    await setSize(page, s);
    await open(page);
    await page.getByRole('button', { name: 'Trimite solicitarea' }).waitFor();
    await page.waitForTimeout(300); // a new screen starts at the top first (useScrollMemory)
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(150);
    await shot(page, `${prefix}-end-${s.width}`);
    const body = page.getByLabel('Descriere');
    await body.focus();
    await openKeyboard(page, s, 'iphone');
    await shot(page, `${prefix}-keyboard-${s.width}`);
    await page.getByLabel('Codul programării (opțional)').focus();
    await page.waitForTimeout(300);
    await shot(page, `${prefix}-keyboard-last-${s.width}`);
    await closeKeyboard(page, s, 'iphone');
  }
}

test.describe('the phone keyboard over the forms', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');
  test.skip(() => name() !== 'mobile-390', 'the sizes are set by the test itself');
  test.setTimeout(600_000);

  test('sign-in and a new account (no bottom bar)', async ({ page }) => {
    const results: string[] = [];
    await checkForm(
      page,
      {
        label: 'Intră în cont',
        open: async (p) => {
          await p.goto('/intra');
          await expect(p.getByLabel('Email')).toBeVisible();
        },
        submit: (p) => p.getByRole('button', { name: 'Intră în cont' }),
      },
      results,
    );
    await checkForm(
      page,
      {
        label: 'Cont nou',
        open: async (p) => {
          await p.goto('/cont-nou');
          await expect(p.getByLabel('Email')).toBeVisible();
        },
      },
      results,
    );
    report(results);
  });

  test('client: a new request (with errors), a request, suggestions, the garage, the account', async ({ page }) => {
    const client = await createUser('client');
    const results: string[] = [];
    await signIn(page, client, PASSWORD);
    await expect(page).toHaveURL(/\/c\//);
    const req = await rpcAs<{ id: string }>(client, 'create_support_request', {
      p_category: 'technical',
      p_title: `Tastatura ${stamp()}`,
      p_body: 'Text',
      p_booking_ref: null,
      p_request_id: randomUUID(),
    });
    const newRequest = async (p: Page) => {
      await p.goto('/c/cont/ajutor/solicitari/noua');
      await expect(h1(p)).toHaveText('Solicitare nouă');
    };
    await pictures(page, newRequest, process.env.KB_SHOTS ?? 'kb-after');
    await checkForm(
      page,
      {
        label: 'Solicitare nouă',
        open: newRequest,
        submit: (p) => p.getByRole('button', { name: /^(Trimite solicitarea|Încearcă din nou)$/ }),
        errors: async (p) => {
          await p.getByRole('button', { name: 'Trimite solicitarea' }).click();
          await expect(p.getByText('Alege categoria.')).toBeVisible();
        },
      },
      results,
    );
    await checkForm(
      page,
      {
        label: 'Solicitare (răspuns)',
        open: async (p) => {
          await p.goto(`/c/cont/ajutor/solicitari/${req.id}`);
          await expect(p.getByLabel('Mesajul tău')).toBeVisible();
        },
        submit: (p) => p.getByRole('button', { name: 'Trimite mesajul' }),
      },
      results,
    );
    await checkForm(
      page,
      {
        label: 'Sugestii',
        open: async (p) => {
          await p.goto('/c/cont/sugestii');
          await expect(h1(p)).toBeVisible();
          await expect(p.locator('main textarea')).toBeVisible();
        },
      },
      results,
    );
    await checkForm(
      page,
      {
        label: 'Garaj: mașină nouă',
        open: async (p) => {
          await p.goto('/c/garaj/nou');
          await expect(h1(p)).toBeVisible();
          await expect(p.locator('main input').first()).toBeVisible();
        },
      },
      results,
    );
    await checkForm(
      page,
      {
        label: 'Cont: datele mele',
        open: async (p) => {
          await p.goto('/c/cont');
          await expect(p.getByLabel('Nume', { exact: false }).first()).toBeVisible();
        },
      },
      results,
    );
    report(results);
  });

  test('client: booking a shop and a conversation', async ({ page, browser }) => {
    const results: string[] = [];
    const [shop] = await serviceRest<{ id: string }[]>('shops?select=id&order=created_at&limit=1', 'GET');
    const { shopId } = await createBookableShop(`Atelier Tastatura ${stamp()}`, ['ulei']);
    const threads = await serviceRest<{ id: string }[]>(`threads?select=id&shop_id=eq.${shop!.id}&limit=1`, 'GET');
    // A new client (no car yet): the booking asks for the car in a form, its button held at the bottom.
    const fresh = await newPage(browser);
    await installKeyboard(fresh.context());
    await signIn(fresh, await createUser('client'), PASSWORD);
    await expect(fresh).toHaveURL(/\/c\//);
    await checkForm(
      fresh,
      {
        label: 'Programare: mașina',
        open: async (p) => {
          // Service, day and time chosen: step 4, the car (a new client has none: the form).
          await p.goto(`/c/service/${shopId}/programare?pas=2&serviciu=ulei`);
          await p
            .getByRole('button', { name: /: \d+ (loc|locuri)$/ })
            .first()
            .click();
          await p
            .getByRole('button', { name: /^\d{2}:\d{2}$/, disabled: false })
            .first()
            .click();
          await expect(p.getByRole('heading', { level: 1, name: 'Mașina' })).toBeVisible();
          await expect(p.getByLabel('Marcă')).toBeVisible();
        },
        submit: (p) => p.getByRole('button', { name: 'Trimite cererea' }),
      },
      results,
    );
    await fresh.context().close();
    await signIn(page, SEED.client, SEED_PASSWORD);
    await expect(page).toHaveURL(/\/c\//);
    if (threads[0]) {
      await checkForm(
        page,
        {
          label: 'Mesaje (client)',
          open: async (p) => {
            await p.goto(`/c/mesaje/${threads[0]!.id}`);
            await expect(p.getByLabel('Mesaj', { exact: true })).toBeVisible();
          },
          submit: (p) => p.getByRole('button', { name: /^Trimite/ }),
        },
        results,
      );
    }
    report(results);
  });

  test('shop: settings and billing', async ({ page }) => {
    const results: string[] = [];
    await signIn(page, SEED.shop, SEED_PASSWORD);
    await expect(page).toHaveURL(/\/s\//);
    await checkForm(
      page,
      {
        label: 'Setări: profil',
        open: async (p) => {
          await p.goto('/s/cont/setari/profil');
          await expect(p.locator('main input').first()).toBeVisible();
        },
        submit: (p) => p.locator('main [data-fixed-bottom] button, main form button[type="submit"]').last(),
      },
      results,
    );
    await checkForm(
      page,
      {
        label: 'Setări: facturare',
        open: async (p) => {
          await p.goto('/s/cont/setari/facturare');
          await expect(p.locator('main input').first()).toBeVisible();
        },
        submit: (p) => p.locator('main [data-fixed-bottom] button, main form button[type="submit"]').last(),
      },
      results,
    );
    report(results);
  });

  test('shop: a booking added by the shop, the quote editor, a conversation', async ({ page }) => {
    const results: string[] = [];
    await signIn(page, SEED.shop, SEED_PASSWORD);
    await expect(page).toHaveURL(/\/s\//);
    const [booking] = await serviceRest<{ id: string }[]>('bookings?select=id&status=eq.in_inspection&limit=1', 'GET');
    const [shop] = await serviceRest<{ id: string }[]>('shops?select=id&order=created_at&limit=1', 'GET');
    const [thread] = await serviceRest<{ id: string }[]>(`threads?select=id&shop_id=eq.${shop!.id}&limit=1`, 'GET');
    await checkForm(
      page,
      {
        label: 'Programare adăugată de service',
        open: async (p) => {
          await p.goto('/s/programari/nou');
          await expect(p.locator('main input').first()).toBeVisible();
        },
        submit: (p) => p.getByRole('button', { name: 'Adaugă programarea' }),
      },
      results,
    );
    if (booking) {
      await checkForm(
        page,
        {
          label: 'Deviz',
          open: async (p) => {
            await p.goto(`/s/programari/deviz/${booking.id}`);
            await expect(p.locator('main input').first()).toBeVisible();
          },
          submit: (p) => p.getByRole('button', { name: /^Trimite devizul/ }),
        },
        results,
      );
    }
    if (thread) {
      await checkForm(
        page,
        {
          label: 'Mesaje (service)',
          open: async (p) => {
            await p.goto(`/s/mesaje/${thread.id}`);
            await expect(p.getByLabel('Mesaj', { exact: true })).toBeVisible();
          },
          submit: (p) => p.getByRole('button', { name: /^Trimite/ }),
        },
        results,
      );
    }
    report(results);
  });

  test('fleet: an expense', async ({ page }) => {
    const { admin, company } = await fleetSetup();
    const results: string[] = [];
    await signIn(page, admin, PASSWORD);
    await expect(page).toHaveURL(/\/c\//);
    await checkForm(
      page,
      {
        label: 'Flotă: cheltuială',
        open: async (p) => {
          await p.goto(`/c/firme/${company}?sectiune=costuri`);
          await p.getByRole('button', { name: 'Adaugă cheltuială' }).click();
          await expect(p.getByLabel('Service sau furnizor')).toBeVisible();
        },
        submit: (p) => p.getByRole('button', { name: 'Salvează cheltuiala' }),
      },
      results,
    );
    report(results);
  });
  // Eduard's iPhone, 13 Nov 2026 (Costuri, a company without expenses): the form ends the page. The
  // keyboard opened, the bottom bar stepped aside and the page got shorter by its height, so the
  // page dropped and „Service sau furnizor” stayed under the keyboard; Safari moved what is seen and
  // the header slid up under the status bar. Played at the end of the page, then with Safari's move.
  test('iPhone: the expense form at the end of a short page (the reported screen)', async ({ page }) => {
    const { admin, company } = await fleetSetup();
    await signIn(page, admin, PASSWORD);
    await expect(page).toHaveURL(/\/c\//);
    const prefix = process.env.KB_SHOTS ?? 'kb-after';
    for (const s of SIZES) {
      const where = `Costuri @${s.width}`;
      await setSize(page, s);
      await page.goto(`/c/firme/${company}?sectiune=costuri`);
      await page.getByRole('button', { name: 'Adaugă cheltuială' }).click();
      const field = page.getByLabel('Service sau furnizor');
      await expect(field).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(200);
      const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
      // Safari first moves what is seen 43 px down the page (measured on the screenshot), then the
      // keyboard settles and the app places the field.
      await field.focus();
      await page.evaluate(() => (window as unknown as { __setPan: (p: number) => void }).__setPan(43));
      await openKeyboard(page, s, 'iphone');
      await shot(page, `${prefix}-costuri-keyboard-${s.width}`);
      // What the person sees on the iPhone: from where Safari moved the view down to the keyboard.
      const seen = await page.evaluate(() => ({ y: window.visualViewport!.offsetTop, h: window.visualViewport!.height }));
      await page.screenshot({ path: `${OUT}/${prefix}-costuri-seen-${s.width}.png`, clip: { x: 0, y: seen.y, width: s.width, height: seen.h } });
      expect.soft(await page.evaluate(() => document.documentElement.scrollHeight), `${where}: the page does not get shorter`).toBeGreaterThanOrEqual(pageHeight);
      const header = await page.locator('header').first().boundingBox();
      expect.soft(Math.round(header!.y), `${where}: the header stays at the top of what is seen`).toBe(43);
      let b = await band(page);
      const box = (await field.boundingBox())!;
      expect.soft(box.y, `${where}: the field below the header`).toBeGreaterThanOrEqual(b.top - 1);
      expect.soft(box.y + box.height, `${where}: the field above the keyboard`).toBeLessThanOrEqual(b.bottom + 1);
      expect.soft(await coveredBy(field), `${where}: nothing over the field`).toBe('');
      // Its label is seen too (the label „Vehicul” was cut on the iPhone), where both fit between the
      // header and the keyboard (not on a 320 px iPhone: the field alone is shown there).
      const label = (await page.locator('label', { hasText: /^Service sau furnizor$/ }).first().boundingBox())!;
      if (box.y + box.height - label.y + 32 <= b.bottom - b.top) {
        expect.soft(label.y, `${where}: the label below the header`).toBeGreaterThanOrEqual(b.top - 1);
      }

      // The last button is reached above the keyboard: the person scrolls until it is just above it.
      const save = page.getByRole('button', { name: 'Salvează cheltuiala' });
      await page.getByLabel('Descriere').focus();
      await page.waitForTimeout(300);
      b = await band(page);
      const before = (await save.boundingBox())!;
      await page.evaluate((dy) => {
        window.dispatchEvent(new Event('touchmove')); // a finger, not the browser
        window.scrollBy(0, dy);
      }, before.y + before.height - (b.bottom - 16));
      await page.waitForTimeout(150);
      b = await band(page);
      const sb = (await save.boundingBox())!;
      expect.soft(sb.y + sb.height, `${where}: the save button above the keyboard`).toBeLessThanOrEqual(b.bottom + 1);
      expect.soft(sb.y, `${where}: the save button below the header`).toBeGreaterThanOrEqual(b.top - 1);
      expect.soft(await coveredBy(save), `${where}: nothing over the save button`).toBe('');
      await shot(page, `${prefix}-costuri-save-${s.width}`);

      // Keyboard closed: the header back at the top, the bar back, the page as long as before.
      await closeKeyboard(page, s, 'iphone');
      expect.soft(Math.round((await page.locator('header').first().boundingBox())!.y), `${where}: header back`).toBe(0);
      expect.soft(await page.evaluate(() => document.documentElement.scrollHeight), `${where}: no gap left`).toBe(pageHeight);
      await shot(page, `${prefix}-costuri-closed-${s.width}`);
    }
  });
  // Eduard, 13 Nov 2026 (iPhone): with the keyboard open the page jumped back when he scrolled by
  // hand. Safari reports a change of what is seen while the page is scrolled (its bars move), and
  // every report placed the field again. The scenarios he listed, on the expense form: fields at
  // the top, in the middle, near the end and on the last row, a text area, „Next”, a scroll by hand
  // up and down, closing and reopening the keyboard, a list next to it, the phone turned, saving.
  test('iPhone: every field is brought above the keyboard once, and the scroll stays the person’s', async ({ page }) => {
    const { admin, company, vehicle } = await fleetSetup();
    page.setDefaultTimeout(20_000);
    await signIn(page, admin, PASSWORD);
    await expect(page).toHaveURL(/\/c\//);
    const scrollY = () => page.evaluate(() => Math.round(window.scrollY));
    /** What Safari does while the page is scrolled with the keyboard open: it reports what is seen again. */
    const safariReports = async () => {
      for (let i = 0; i < 4; i++) {
        await page.evaluate(() => {
          window.visualViewport!.dispatchEvent(new Event('resize'));
          window.visualViewport!.dispatchEvent(new Event('scroll'));
        });
        await page.waitForTimeout(60);
      }
      await page.waitForTimeout(300);
    };
    const seen = async (field: Locator, what: string) => {
      const b = await band(page);
      const box = (await field.boundingBox())!;
      expect.soft(box.y, `${what}: below the header`).toBeGreaterThanOrEqual(b.top - 1);
      expect.soft(box.y + Math.min(box.height, 60), `${what}: above the keyboard`).toBeLessThanOrEqual(b.bottom + 1);
      expect.soft(await coveredBy(field), `${what}: nothing over it`).toBe('');
    };

    for (const s of [SIZES[0], SIZES[2]]) {
      const at = `@${s.width}`;
      await setSize(page, s);
      await page.goto(`/c/firme/${company}?sectiune=costuri`);
      await page.getByRole('button', { name: 'Adaugă cheltuială' }).click();
      const amount = page.getByLabel('Suma');
      const liters = page.getByLabel('Litri');
      const fuel = page.getByLabel('Tip combustibil');
      const vendor = page.getByLabel('Service sau furnizor');
      const km = page.getByLabel('Kilometraj');
      const description = page.getByLabel('Descriere');
      await expect(vendor).toBeVisible();

      // 1. A field at the top, already seen above where the keyboard comes: nothing moves.
      await amount.evaluate((el) => {
        const header = document.querySelector('header')!.getBoundingClientRect().bottom;
        const label = (el as HTMLInputElement).labels![0]!.getBoundingClientRect().top;
        window.scrollBy(0, label - (header + 20));
      });
      await page.waitForTimeout(150);
      const before = await scrollY();
      await amount.focus();
      await openKeyboard(page, s, 'iphone');
      await seen(amount, `${at} top field`);
      expect.soft(await scrollY(), `${at} top field: already seen, the page does not move`).toBe(before);

      // 6. „Next”: the focus moves with the keyboard open — the middle, near the end, the last row (a text area).
      for (const [field, what] of [
        [liters, 'middle field'],
        [km, 'field near the end'],
        [description, 'text area on the last row'],
      ] as const) {
        await field.focus();
        await page.waitForTimeout(350);
        await expect(page.locator('html')).toHaveAttribute('data-keyboard', '');
        await seen(field, `${at} ${what} (Next)`);
      }

      // Typing moves nothing and keeps the focus and the text.
      const typed = await scrollY();
      await description.pressSequentially('Plin la pompa 4', { delay: 15 });
      await safariReports();
      expect.soft(await scrollY(), `${at}: typing does not move the page`).toBe(typed);
      await expect(description).toBeFocused();
      await expect(description).toHaveValue('Plin la pompa 4');

      // 7. A scroll up by hand with the keyboard open (the wheel, then Safari's reports): it stays.
      await page.mouse.move(s.width / 2, 150);
      await page.mouse.wheel(0, -260);
      await page.waitForTimeout(250);
      const up = await scrollY();
      expect.soft(up, `${at}: the page scrolled up by hand`).toBeLessThan(typed - 100);
      await safariReports();
      expect.soft(await scrollY(), `${at}: the scroll up is not undone`).toBe(up);
      await expect(description).toBeFocused();
      await expect(page.locator('html')).toHaveAttribute('data-keyboard', '');

      // 8. A scroll down by hand (a finger: touchmove, the page follows), to the very end: it stays.
      await page.evaluate(() => {
        window.dispatchEvent(new Event('touchmove'));
        window.scrollTo(0, document.documentElement.scrollHeight);
      });
      await page.waitForTimeout(250);
      const down = await scrollY();
      expect.soft(down, `${at}: the page scrolled down by hand`).toBeGreaterThan(up + 100);
      await safariReports();
      expect.soft(await scrollY(), `${at}: the scroll down is not undone`).toBe(down);
      // The end of the page: the save button is above the keyboard, nothing over it.
      const save = page.getByRole('button', { name: 'Salvează cheltuiala' });
      const b = await band(page);
      const sb = (await save.boundingBox())!;
      expect.soft(sb.y + sb.height, `${at}: the save button above the keyboard at the end of the page`).toBeLessThanOrEqual(b.bottom + 1);
      // The room under it is the part the keyboard covers and a gap, not more.
      const room = await page.evaluate(() => parseFloat(getComputedStyle(document.body).paddingBottom));
      expect.soft(room, `${at}: no more room than the keyboard and a gap`).toBeLessThanOrEqual(s.keyboard + 60);

      // 11. A list next to the keyboard (the iPhone's wheel takes the keyboard's place).
      await fuel.focus();
      await page.waitForTimeout(350);
      await seen(fuel, `${at} list (Tip combustibil)`);

      // 9. The keyboard closes: the bar is back, the room is gone, the page is at a place that exists.
      await closeKeyboard(page, s, 'iphone');
      await expect(page.locator('html')).not.toHaveAttribute('data-keyboard', '');
      expect.soft(await page.evaluate(() => parseFloat(getComputedStyle(document.body).paddingBottom)), `${at}: no room left`).toBe(0);
      expect.soft(await page.evaluate(() => window.scrollY <= document.documentElement.scrollHeight - window.innerHeight + 1), `${at}: no gap under the page`).toBe(true);

      // 10. Opened again on another field: placed again.
      await vendor.focus();
      await openKeyboard(page, s, 'iphone');
      await seen(vendor, `${at} reopened on Service sau furnizor`);
      await closeKeyboard(page, s, 'iphone');
    }

    // 13. The phone is turned with the keyboard open: still known as open, the field still seen.
    const tall = SIZES[2];
    await setSize(page, tall);
    const vendor = page.getByLabel('Service sau furnizor');
    await vendor.focus();
    await openKeyboard(page, tall, 'iphone');
    await page.setViewportSize({ width: 740, height: 340 });
    await page.evaluate(() => (window as unknown as { __setKeyboard: (h: number) => void }).__setKeyboard(180));
    await page.waitForTimeout(400);
    await expect(page.locator('html'), 'turned: the keyboard is still known').toHaveAttribute('data-keyboard', '');
    const turned = await band(page);
    const box = (await vendor.boundingBox())!;
    expect.soft(box.y + box.height, 'turned: the field above the keyboard').toBeLessThanOrEqual(turned.bottom + 1);
    await closeKeyboard(page, tall, 'iphone');
    await setSize(page, tall);

    // 14. The form is saved with what was typed.
    await page.locator('#continut').getByLabel('Vehicul', { exact: true }).filter({ visible: true }).last().selectOption(vehicle);
    const amount = page.getByLabel('Suma');
    await amount.focus();
    await openKeyboard(page, tall, 'iphone');
    await amount.fill('123');
    await vendor.focus();
    await page.waitForTimeout(350);
    await vendor.fill('Stația de test');
    await expect(amount).toHaveValue('123');
    await closeKeyboard(page, tall, 'iphone');
    await page.getByRole('button', { name: 'Salvează cheltuiala' }).click();
    await expect(page.getByText('Stația de test').first()).toBeVisible({ timeout: 15_000 });
  });

  // 12. A form in a window over the page („Sesiunea a expirat”): centered above the keyboard, and the
  // page behind it does not move.
  test('iPhone: the form in the session-expired window stays above the keyboard', async ({ page }) => {
    const email = await createUser('client');
    // The phone's size from the start (a page keeps the tallest height it has seen at a width).
    const s = SIZES[2];
    await setSize(page, s);
    await signIn(page, email, PASSWORD);
    await expect(page).toHaveURL(/\/c\//);
    const key = await page.evaluate(() => Object.keys(localStorage).find((k) => k.startsWith('sb-') && k.endsWith('-auth-token')));
    const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k!)!), key);
    await revokeSessions(stored.access_token);
    await page.evaluate(([k, value]) => localStorage.setItem(k!, value!), [key, JSON.stringify({ ...stored, expires_at: Math.floor(Date.now() / 1000) - 10 })]);
    await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
    const panel = page.getByRole('dialog', { name: 'Sesiunea a expirat' });
    await expect(panel).toBeVisible({ timeout: 40_000 });
    const password = panel.getByLabel('Parolă', { exact: true });
    const behind = await page.evaluate(() => window.scrollY);
    await password.focus();
    await page.evaluate(() => (window as unknown as { __setPan: (p: number) => void }).__setPan(60));
    await openKeyboard(page, s, 'iphone');
    const view = await page.evaluate(() => ({ top: window.visualViewport!.offsetTop, bottom: window.visualViewport!.offsetTop + window.visualViewport!.height }));
    const submit = panel.getByRole('button', { name: 'Intră în cont' });
    const inView = async (el: Locator, what: string) => {
      const box = (await el.boundingBox())!;
      expect.soft(box.y, `${what}: inside what is seen`).toBeGreaterThanOrEqual(view.top);
      expect.soft(box.y + box.height, `${what}: above the keyboard`).toBeLessThanOrEqual(view.bottom + 1);
    };
    // The field typed in is seen at once; the title and the button are reached by scrolling the window.
    await inView(password, 'the password');
    await submit.evaluate((el) => el.scrollIntoView({ block: 'nearest' }));
    await inView(submit, 'the button');
    await panel.getByRole('heading').evaluate((el) => el.scrollIntoView({ block: 'nearest' }));
    await inView(panel.getByRole('heading'), 'the title');
    expect.soft(await page.evaluate(() => window.scrollY), 'the page behind does not move').toBe(behind);
    await shot(page, `${process.env.KB_SHOTS ?? 'kb-after'}-sesiune-expirata-${s.width}`);
    await closeKeyboard(page, s, 'iphone');
    await password.fill(PASSWORD);
    await submit.click();
    await expect(panel).toHaveCount(0, { timeout: 30_000 });
  });
});
