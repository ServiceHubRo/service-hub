import { appendFileSync, mkdirSync } from 'node:fs';
import { test, type Page } from '@playwright/test';

// Investigation only: three ways to keep a reload at the top, measured frame by frame.
const OUT = process.env.VISUAL_OUT ?? 'visual-audit';
const VIEWS = [
  { name: 'phone-390', width: 390, height: 844 },
  { name: 'tablet-820', width: 820, height: 1180 },
  { name: 'desktop-1440', width: 1440, height: 900 },
] as const;

function sampler() {
  const frames: number[] = [];
  (window as unknown as { __frames: number[] }).__frames = frames;
  const t0 = performance.now();
  const y = () => Math.round((document.scrollingElement ?? document.documentElement).scrollTop);
  const sample = () => {
    frames.push(y());
    if (performance.now() - t0 < 4500) requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
  sessionStorage.setItem('sh_test_init', '1');
  localStorage.setItem('sh_lang', 'ro');
}

const y = (page: Page) => page.evaluate(() => Math.round((document.scrollingElement ?? document.documentElement).scrollTop));

for (const v of VIEWS) {
  test(`${v.name}: reload variants`, async ({ browser }) => {
    test.setTimeout(300_000);
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: v.width, height: v.height }, hasTouch: v.width < 1024, reducedMotion: 'reduce' });
    await context.addInitScript(sampler);
    const page = await context.newPage();
    mkdirSync(`${OUT}/variants`, { recursive: true });
    for (const variant of ['0', '1', '2']) {
      for (const share of [0.5, 1]) {
        for (let rep = 0; rep < 3; rep++) {
          await page.goto('/');
          await page.evaluate((x) => localStorage.setItem('sh_reload_variant', x), variant);
          await page.waitForLoadState('load');
          await page.evaluate((s) => window.scrollTo(0, Math.round((document.documentElement.scrollHeight - innerHeight) * s)), share);
          await page.waitForTimeout(400);
          const before = await y(page);
          await page.reload();
          await page.waitForTimeout(4600);
          const frames = await page.evaluate(() => (window as unknown as { __frames: number[] }).__frames);
          const after = await y(page);
          const mode = await page.evaluate(() => history.scrollRestoration);
          appendFileSync(
            `${OUT}/variants/rows.jsonl`,
            `${JSON.stringify({ view: v.name, variant, share, rep, before, after, mode, aboveTop: frames.filter((f) => f > 0).length, frames: frames.length, firstNonZero: frames.findIndex((f) => f > 0), lastNonZero: frames.map((f, i) => (f > 0 ? i : -1)).reduce((a, b) => Math.max(a, b), -1), max: Math.max(...frames) })}\n`,
          );
        }
      }
      // After a reload: leave by a link and come back with Back — the browser's place, as before?
      await page.goto('/');
      await page.reload();
      await page.waitForTimeout(1500);
      const offer = page.getByRole('link', { name: /^Profită acum/ }).first();
      await offer.scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      const left = await y(page);
      await offer.click();
      await page.waitForURL(/cont-nou/);
      await page.waitForTimeout(500);
      await page.goBack();
      await page.waitForURL((u) => u.pathname === '/');
      await page.waitForTimeout(1000);
      appendFileSync(`${OUT}/variants/rows.jsonl`, `${JSON.stringify({ view: v.name, variant, check: 'back-after-reload', left, back: await y(page) })}\n`);
    }
    await context.close();
  });
}
