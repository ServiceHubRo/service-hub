import { appendFileSync, mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { BACKEND, PASSWORD, createUser, signIn } from '../e2e/support';

/**
 * Investigation (Eduard, 13 Nov 2026): where a page opens after a reload, after signing out, and
 * whether normal navigation, the in-app „‹ Înapoi” and the browser's Back / Forward keep their
 * places. Measures the page's offset, history.scrollRestoration, the navigation type, every scroll
 * call made by code during the load, and any area that scrolls on its own (not the page).
 */

const OUT = process.env.VISUAL_OUT ?? 'visual-audit';
const VIEWS = [
  { name: 'phone-390', width: 390, height: 844 },
  { name: 'tablet-820', width: 820, height: 1180 },
  { name: 'desktop-1440', width: 1440, height: 900 },
] as const;

function tracer() {
  const w = window as unknown as { __calls: string[] };
  w.__calls = [];
  const y = () => Math.round((document.scrollingElement ?? document.documentElement).scrollTop);
  for (const [obj, name] of [
    [window, 'scrollTo'],
    [window, 'scroll'],
    [Element.prototype, 'scrollTo'],
    [Element.prototype, 'scrollIntoView'],
  ] as const) {
    const target = obj as unknown as Record<string, (...a: unknown[]) => unknown>;
    const orig = target[name]!;
    target[name] = function (this: unknown, ...args: unknown[]) {
      w.__calls.push(`${Math.round(performance.now())}ms ${name}(${JSON.stringify(args).slice(0, 40)}) at y=${y()} ${location.pathname}`);
      return orig.apply(this, args);
    };
  }
  // Every frame's offset from the start of the document: a place shown even for a frame shows here.
  const frames: number[] = [];
  (window as unknown as { __frames: number[] }).__frames = frames;
  const t0 = performance.now();
  const sample = () => {
    frames.push(y());
    if (performance.now() - t0 < 3000) requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
  sessionStorage.setItem('sh_test_init', '1');
  localStorage.setItem('sh_lang', 'ro');
  localStorage.setItem('sh_onboarding_off', '1');
}

const y = (page: Page) => page.evaluate(() => Math.round((document.scrollingElement ?? document.documentElement).scrollTop));
const info = (page: Page) =>
  page.evaluate(() => {
    const scrollers = Array.from(document.querySelectorAll('body *'))
      .filter((el) => {
        const cs = getComputedStyle(el);
        return /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1 && el.getBoundingClientRect().height > 0;
      })
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} ${el.scrollTop}/${el.scrollHeight - el.clientHeight}`);
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    return {
      y: Math.round((document.scrollingElement ?? document.documentElement).scrollTop),
      max: document.documentElement.scrollHeight - innerHeight,
      url: location.pathname + location.search,
      restoration: history.scrollRestoration,
      navType: nav?.type,
      scrollers,
      calls: (window as unknown as { __calls?: string[] }).__calls ?? [],
      framesSeen: ((window as unknown as { __frames?: number[] }).__frames ?? []).length,
      framesAboveTop: ((window as unknown as { __frames?: number[] }).__frames ?? []).filter((v) => v > 0).length,
      framesMax: Math.max(0, ...((window as unknown as { __frames?: number[] }).__frames ?? [])),
    };
  });

function keep(row: Record<string, unknown>) {
  mkdirSync(`${OUT}/scroll`, { recursive: true });
  appendFileSync(`${OUT}/scroll/trace.jsonl`, `${JSON.stringify(row)}\n`);
}

async function scrollToShare(page: Page, share: number) {
  await page.evaluate((s) => window.scrollTo(0, Math.round((document.documentElement.scrollHeight - innerHeight) * s)), share);
  await page.waitForTimeout(400);
}

/** A reload from a place on the page: the offset right after it, after the load, and a moment later. */
async function reloadFrom(page: Page, view: string, label: string, share: number) {
  await scrollToShare(page, share);
  const before = await info(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  const atReady = await y(page);
  await page.waitForLoadState('load');
  const atLoad = await y(page);
  await page.waitForTimeout(1500);
  const after = await info(page);
  await page.screenshot({ path: `${OUT}/scroll/${view}-${label}.jpg`, type: 'jpeg', quality: 55 });
  keep({ view, scenario: label, before: { y: before.y, max: before.max, restoration: before.restoration, scrollers: before.scrollers }, atReady, atLoad, after });
}

test.describe('scroll trace', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');
  test.setTimeout(240_000);

  for (const v of VIEWS) {
    test(`${v.name}: reloads, sign-out, navigation, back and forward`, async ({ browser }) => {
      const context = await browser.newContext({
        baseURL: test.info().project.use.baseURL,
        viewport: { width: v.width, height: v.height },
        hasTouch: v.width < 1024,
        reducedMotion: 'reduce',
        timezoneId: 'Europe/Berlin',
      });
      await context.addInitScript(tracer);
      const page = await context.newPage();

      // Public page.
      await page.goto('/');
      await page.waitForLoadState('load');
      await reloadFrom(page, v.name, 'landing-reload-middle', 0.5);
      await reloadFrom(page, v.name, 'landing-reload-end', 1);

      // Public back / forward: the price → „Profită acum” → Back → Forward.
      await page.goto('/');
      await page.waitForLoadState('load');
      const offer = page.getByRole('link', { name: /^Profită acum/ }).first();
      await offer.scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      const landingY = await y(page);
      await offer.click();
      await page.waitForURL(/cont-nou/);
      await page.waitForTimeout(600);
      const signUpY = await y(page);
      await page.goBack();
      await page.waitForURL((u) => u.pathname === '/');
      await page.waitForTimeout(800);
      const backY = await y(page);
      await page.goForward();
      await page.waitForURL(/cont-nou/);
      await page.waitForTimeout(800);
      const forwardY = await y(page);
      keep({ view: v.name, scenario: 'public-back-forward', landingY, signUpY, backY, forwardY, restoration: (await info(page)).restoration });

      // Signed in.
      await signIn(page, await createUser('client'), PASSWORD);
      await expect(page).toHaveURL(/\/c\/cauta/);
      await page.goto('/c/cont');
      await expect(page.getByRole('heading', { level: 1, name: 'Cont' })).toBeVisible();
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await reloadFrom(page, v.name, 'cont-reload-middle', 0.5);
      await expect(page.getByRole('heading', { level: 1, name: 'Cont' })).toBeVisible();
      await reloadFrom(page, v.name, 'cont-reload-end', 1);

      // Normal navigation inside the app: Cont (middle) → Notificări (a new screen) → „‹ Cont” →
      // browser Back → browser Forward.
      await expect(page.getByRole('heading', { level: 1, name: 'Cont' })).toBeVisible();
      await scrollToShare(page, 0.5);
      const contY = await y(page);
      await page.locator('main').getByRole('link', { name: /^Notificări/ }).first().click();
      await expect(page.getByRole('heading', { level: 1, name: 'Notificări' })).toBeVisible();
      await page.waitForTimeout(500);
      const notifY = await y(page);
      await page.locator('main').getByRole('link', { name: /^Cont$/ }).first().click();
      await expect(page.getByRole('heading', { level: 1, name: 'Cont' })).toBeVisible();
      await page.waitForTimeout(800);
      const backLinkY = await y(page);
      await page.goBack();
      await page.waitForTimeout(800);
      const browserBack = { url: new URL(page.url()).pathname, y: await y(page) };
      await page.goForward();
      await page.waitForTimeout(800);
      const browserForward = { url: new URL(page.url()).pathname, y: await y(page) };
      keep({ view: v.name, scenario: 'app-navigation', contY, notifY, backLinkY, browserBack, browserForward, restoration: (await info(page)).restoration });

      // Sign-out from the middle of Cont.
      await page.goto('/c/cont');
      await expect(page.getByRole('heading', { level: 1, name: 'Cont' })).toBeVisible();
      await scrollToShare(page, 0.5);
      const fromY = await y(page);
      await page.getByRole('button', { name: 'Deconectare', exact: true }).filter({ visible: true }).first().click();
      await page.getByRole('button', { name: 'Deconectează-mă' }).click();
      await page.waitForURL((u) => u.pathname === '/');
      await page.waitForTimeout(1000);
      const out = await info(page);
      await page.screenshot({ path: `${OUT}/scroll/${v.name}-logout.jpg`, type: 'jpeg', quality: 55 });
      keep({ view: v.name, scenario: 'logout-from-middle', fromY, after: { y: out.y, url: out.url, restoration: out.restoration } });
      await context.close();
    });
  }
});
