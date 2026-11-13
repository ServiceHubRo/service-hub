import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { BACKEND, SEED, SEED_PASSWORD, signIn } from '../e2e/support';

/**
 * Investigation (Eduard, 13 Nov 2026): after „Deconectează-mă” the landing page opens in the middle,
 * at „Pentru șoferi”. Records what happens, frame by frame: every address change (push, replace,
 * pop, hash), every scroll call made by code (window/element scrollTo, scrollBy, scrollIntoView,
 * scrollTop, focus) with where it came from, and the page's scroll position.
 */

const OUT = process.env.VISUAL_OUT ?? 'visual-audit';

function tracer() {
  type Entry = Record<string, unknown>;
  const trace: Entry[] = [];
  (window as unknown as { __trace: Entry[] }).__trace = trace;
  const y = () => Math.round((document.scrollingElement ?? document.documentElement).scrollTop);
  const where = () => location.pathname + location.search + location.hash;
  const stack = () => (new Error().stack ?? '').split('\n').slice(3, 8).map((l) => l.trim()).join(' < ');
  const log = (kind: string, extra: Entry = {}) => trace.push({ t: Math.round(performance.now()), kind, y: y(), url: where(), ...extra });
  const describe = (el: unknown) =>
    el === window ? 'window' : el instanceof Element ? `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${String(el.className).split(' ')[0]}`.slice(0, 70) : String(el);
  const wrap = (obj: object, name: string) => {
    const target = obj as Record<string, (...a: unknown[]) => unknown>;
    const orig = target[name];
    if (typeof orig !== 'function') return;
    target[name] = function (this: unknown, ...args: unknown[]) {
      log(`call ${name}`, { on: describe(this), args: JSON.stringify(args).slice(0, 80), stack: stack() });
      return orig.apply(this, args);
    };
  };
  for (const name of ['scrollTo', 'scroll', 'scrollBy']) wrap(window, name);
  for (const name of ['scrollTo', 'scroll', 'scrollBy', 'scrollIntoView']) wrap(Element.prototype, name);
  wrap(HTMLElement.prototype, 'focus');
  const top = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
  if (top?.set && top.get) {
    Object.defineProperty(Element.prototype, 'scrollTop', {
      configurable: true,
      get() {
        return top.get!.call(this);
      },
      set(v: number) {
        log('set scrollTop', { on: describe(this), v, stack: stack() });
        top.set!.call(this, v);
      },
    });
  }
  for (const name of ['pushState', 'replaceState'] as const) {
    const orig = history[name];
    history[name] = function (this: History, ...args: Parameters<History['pushState']>) {
      const r = orig.apply(this, args);
      log(`history.${name}`, { to: String(args[2]), state: JSON.stringify(args[0]).slice(0, 80) });
      return r;
    };
  }
  addEventListener('popstate', () => log('popstate'));
  addEventListener('hashchange', () => log('hashchange'));
  let last = -1;
  const frame = () => {
    const now = y();
    if (now !== last) {
      last = now;
      log('position');
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  log('start', { restoration: history.scrollRestoration });
}

/** What is at the top of the screen: the nearest heading above the viewport's upper part. */
async function inView(page: Page) {
  return page.evaluate(() => {
    const headings = Array.from(document.querySelectorAll('h1, h2'));
    let seen = '';
    for (const h of headings) {
      if (h.getBoundingClientRect().top <= 140) seen = (h.textContent ?? '').trim();
    }
    const first = headings.find((h) => {
      const r = h.getBoundingClientRect();
      return r.top >= 0 && r.top < innerHeight;
    });
    return {
      y: Math.round((document.scrollingElement ?? document.documentElement).scrollTop),
      height: document.documentElement.scrollHeight,
      url: location.pathname + location.search + location.hash,
      restoration: history.scrollRestoration,
      sectionAtTop: seen,
      firstHeadingOnScreen: (first?.textContent ?? '').trim(),
    };
  });
}

interface Result {
  scenario: string;
  before: unknown;
  afterConfirmOpen: unknown;
  end: unknown;
  trace: unknown[];
}
const results: Result[] = [];

async function run(page: Page, scenario: string, width: number, height: number, start: string, scrollTo: 'top' | 'bottom', where: 'main' | 'sidebar') {
  await page.setViewportSize({ width, height });
  await page.addInitScript(tracer);
  await signIn(page, SEED.client, SEED_PASSWORD);
  await expect(page).toHaveURL(/\/c\/cauta/, { timeout: 20_000 });
  await page.goto(start);
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);
  await page.evaluate((to) => window.scrollTo(0, to === 'top' ? 0 : document.documentElement.scrollHeight), scrollTo);
  await page.waitForTimeout(400);
  await page.evaluate(() => (window as unknown as { __trace: unknown[] }).__trace.splice(0));
  const before = await inView(page);
  const scope = where === 'main' ? page.locator('main') : page.locator('aside');
  await scope.getByRole('button', { name: /^Deconectare$/ }).click();
  await page.getByRole('button', { name: 'Deconectează-mă' }).waitFor();
  await page.waitForTimeout(400);
  const afterConfirmOpen = await inView(page);
  await page.screenshot({ path: `${OUT}/logout/${scenario}-1-confirm.jpg`, type: 'jpeg', quality: 60 });
  await page.getByRole('button', { name: 'Deconectează-mă' }).click();
  await page.waitForURL((u) => u.pathname === '/', { timeout: 15_000 });
  await page.waitForTimeout(2500);
  const end = await inView(page);
  await page.screenshot({ path: `${OUT}/logout/${scenario}-2-after.jpg`, type: 'jpeg', quality: 60 });
  const trace = await page.evaluate(() => (window as unknown as { __trace: unknown[] }).__trace);
  results.push({ scenario, before, afterConfirmOpen, end, trace });
}

test.describe('logout scroll trace', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');
  test.describe.configure({ mode: 'serial' });

  test.afterAll(() => {
    mkdirSync(`${OUT}/logout`, { recursive: true });
    writeFileSync(`${OUT}/logout/trace.json`, JSON.stringify(results, null, 1));
  });

  test('phone 390: Cont, button at the end of the page', async ({ page }) => {
    mkdirSync(`${OUT}/logout`, { recursive: true });
    await run(page, 'phone-390-cont', 390, 844, '/c/cont', 'top', 'main');
  });

  test('tablet 820: Cont, button at the end of the page', async ({ page }) => {
    await run(page, 'tablet-820-cont', 820, 1180, '/c/cont', 'top', 'main');
  });

  test('desktop 1440: sidebar, page at the top', async ({ page }) => {
    await run(page, 'desktop-1440-top', 1440, 900, '/c/programari', 'top', 'sidebar');
  });

  test('desktop 1440: sidebar, page scrolled to the end', async ({ page }) => {
    await run(page, 'desktop-1440-scrolled', 1440, 900, '/c/cont', 'bottom', 'sidebar');
  });

  test('phone 390: landing scrolled to the price, then „Profită acum” (a public page to another)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(tracer);
    await page.goto('/');
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);
    const cta = page.getByRole('link', { name: /Profită acum|Creează cont/ }).last();
    await cta.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.evaluate(() => (window as unknown as { __trace: unknown[] }).__trace.splice(0));
    const before = await inView(page);
    await cta.click();
    await page.waitForURL(/\/cont-nou/);
    await page.waitForTimeout(1500);
    const end = await inView(page);
    await page.screenshot({ path: `${OUT}/logout/public-390-cta-after.jpg`, type: 'jpeg', quality: 60 });
    const trace = await page.evaluate(() => (window as unknown as { __trace: unknown[] }).__trace);
    results.push({ scenario: 'public-390-landing-to-signup', before, afterConfirmOpen: null, end, trace });
  });
});
