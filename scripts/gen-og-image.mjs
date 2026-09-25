// Generates the link preview image (public/og-image.png, 1200 × 630) shown when someone shares
// service-hub.ro on WhatsApp, Facebook or email. Run with `node scripts/gen-og-image.mjs`; the
// output is committed. The logo is the brand PNG, so the result does not depend on installed fonts.
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const logo = (await readFile('docs/brand/logo/logo-orizontal-transparent.png')).toString('base64');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin: 0; box-sizing: border-box; }
  body { width: 1200px; height: 630px; background: #14161A; color: #EAE8E2;
    font-family: "Liberation Sans Narrow", "Arial Narrow", "Liberation Sans", Arial, sans-serif; }
  .frame { position: absolute; inset: 0; padding: 70px 80px; display: flex; flex-direction: column; justify-content: space-between;
    border-bottom: 14px solid #F5A524; }
  img { width: 560px; height: 112px; }
  h1 { font-size: 76px; line-height: 1.05; font-weight: 700; text-transform: uppercase; letter-spacing: .01em; }
  h1 span { color: #F5A524; }
  p { font-family: "Liberation Sans", Arial, sans-serif; font-size: 32px; color: #8A909B; }
</style></head><body><div class="frame">
  <img src="data:image/png;base64,${logo}" alt="">
  <h1>Programări auto,<br><span>fără telefoane.</span></h1>
  <p>Devizul în aplicație, înainte să se lucreze ceva.</p>
</div></body></html>`;

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
);
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html);
await page.screenshot({ path: 'public/og-image.png' });
await browser.close();
process.stdout.write('public/og-image.png written\n');
