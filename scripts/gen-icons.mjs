// Generates the favicon, PWA icons and Apple touch icon from the brand mark
// (docs/brand/logo/01-marca.svg). Run with `npm run icons`; the output is committed.
import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const OUT = 'public/icons';
const source = await readFile('docs/brand/logo/01-marca.svg', 'utf8');
// Keep only the drawing: drop the embedded provenance metadata and its namespace.
const mark = source.replace(/<metadata>[\s\S]*?<\/metadata>/, '').replace(/\s+xmlns:c2pa="[^"]*"/, '');
const wrench = mark.match(/<g[\s\S]*<\/g>/)[0];

// Full-bleed amber square with the wrench shrunk into the safe zone (maskable / iOS round their own corners).
const fullBleed = (scaleOfMark) => {
  const offset = (512 * (1 - scaleOfMark)) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#F5A524"/>
  <g transform="translate(${offset},${offset}) scale(${scaleOfMark})">${wrench}</g>
</svg>`;
};

await mkdir(OUT, { recursive: true });
await writeFile(`${OUT}/favicon.svg`, mark.trim() + '\n');

const targets = [
  { file: 'favicon-32.png', size: 32, svg: mark },
  { file: 'icon-192.png', size: 192, svg: mark },
  { file: 'icon-512.png', size: 512, svg: mark },
  { file: 'icon-maskable-512.png', size: 512, svg: fullBleed(0.8) },
  { file: 'apple-touch-icon.png', size: 180, svg: fullBleed(0.9) },
];

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
);
const page = await browser.newPage();
for (const { file, size, svg } of targets) {
  await page.setViewportSize({ width: size, height: size });
  const sized = svg.replace(/width="512" height="512"/, `width="${size}" height="${size}"`);
  await page.setContent(`<html><body style="margin:0;background:transparent">${sized}</body></html>`);
  await page.screenshot({ path: `${OUT}/${file}`, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}
await browser.close();
process.stdout.write(`Icons written to ${OUT}\n`);
