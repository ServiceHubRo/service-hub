// Generates the link preview image (public/og-image.png, 1200 × 630) shown when someone shares
// service-hub.ro on WhatsApp, Facebook or email. Run with `node scripts/gen-og-image.mjs`; the
// output is committed. The app's own font (Inter, from node_modules) is embedded, so the result does
// not depend on installed fonts.
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const font = async (subset) =>
  (await readFile(`node_modules/@fontsource-variable/inter/files/inter-${subset}-wght-normal.woff2`)).toString('base64');
const [latin, latinExt] = [await font('latin'), await font('latin-ext')];
const mark = (await readFile('public/icons/favicon.svg')).toString('base64');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  @font-face { font-family: Inter; font-weight: 100 900; src: url(data:font/woff2;base64,${latin}) format('woff2'); unicode-range: U+0000-00FF; }
  @font-face { font-family: Inter; font-weight: 100 900; src: url(data:font/woff2;base64,${latinExt}) format('woff2'); unicode-range: U+0100-024F, U+0218-021B; }
  * { margin: 0; box-sizing: border-box; }
  body { width: 1200px; height: 630px; background: #14161A; color: #EAE8E2; font-family: Inter, sans-serif; }
  .frame { position: absolute; inset: 0; padding: 70px 80px; display: flex; flex-direction: column; justify-content: space-between;
    border-bottom: 14px solid #F5A524; }
  .logo { display: flex; align-items: center; gap: 26px; }
  .logo img { width: 104px; height: 104px; }
  .wordmark { font-size: 64px; font-weight: 800; letter-spacing: -0.01em; white-space: nowrap; }
  .wordmark span { color: #F5A524; }
  h1 { font-size: 80px; line-height: 1.05; font-weight: 800; letter-spacing: -0.03em; }
  h1 span { color: #F5A524; }
  p { font-size: 32px; color: #8A909B; }
</style></head><body><div class="frame">
  <div class="logo"><img src="data:image/svg+xml;base64,${mark}" alt=""><div class="wordmark">SERVICE-<span>HUB</span></div></div>
  <h1>Programări auto,<br><span>fără telefoane.</span></h1>
  <p>Devizul în aplicație, înainte să se lucreze ceva.</p>
</div></body></html>`;

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
);
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: 'public/og-image.png' });
await browser.close();
process.stdout.write('public/og-image.png written\n');
