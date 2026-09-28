// Draws the Android app's icons and launch screens from the brand mark
// (docs/brand/logo/01-marca.svg), in every density, into android/app/src/main/res (T20).
// Run with `node scripts/gen-android-assets.mjs`; the output is committed.
import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';

const RES = 'android/app/src/main/res';
const AMBER = '#F5A524';
const BG = '#14161A';
const source = await readFile('docs/brand/logo/01-marca.svg', 'utf8');
const mark = source.replace(/<metadata>[\s\S]*?<\/metadata>/, '').replace(/\s+xmlns:c2pa="[^"]*"/, '');
const wrench = mark.match(/<g[\s\S]*<\/g>/)[0];

/** The wrench on a 512 canvas, scaled around the centre, over an optional background shape. */
const icon = (scale, back = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  ${back}<g transform="translate(${(512 * (1 - scale)) / 2},${(512 * (1 - scale)) / 2}) scale(${scale})">${wrench}</g>
</svg>`;

const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const SPLASH = {
  mdpi: [320, 480], hdpi: [480, 800], xhdpi: [720, 1280], xxhdpi: [960, 1600], xxxhdpi: [1280, 1920],
};

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
);
const page = await browser.newPage();

async function png(path, width, height, html) {
  await page.setViewportSize({ width, height });
  await page.setContent(`<html><body style="margin:0;background:transparent;overflow:hidden">${html}</body></html>`);
  await page.screenshot({ path, omitBackground: true, clip: { x: 0, y: 0, width, height } });
}
const sized = (svg, size) => svg.replace('width="512" height="512"', `width="${size}" height="${size}"`);

for (const [d, k] of Object.entries(DENSITIES)) {
  const legacy = 48 * k;
  const fg = 108 * k;
  // Before Android 8: the brand mark itself (amber tile), and its round version.
  await png(`${RES}/mipmap-${d}/ic_launcher.png`, legacy, legacy, sized(mark, legacy));
  await png(`${RES}/mipmap-${d}/ic_launcher_round.png`, legacy, legacy,
    sized(icon(0.9, `<circle cx="256" cy="256" r="256" fill="${AMBER}"/>`), legacy));
  // Android 8+: the wrench alone, inside the 66 dp safe zone (about 49 dp wide) of the 108 dp layer; amber behind it.
  await png(`${RES}/mipmap-${d}/ic_launcher_foreground.png`, fg, fg, sized(icon(0.8), fg));

  // Launch screen before Android 12: the tile in the middle of the app's dark background.
  for (const [orient, [w, h]] of [['port', SPLASH[d]], ['land', [...SPLASH[d]].reverse()]]) {
    const tile = Math.round(Math.min(w, h) * 0.28);
    await png(`${RES}/drawable-${orient}-${d}/splash.png`, w, h,
      `<div style="width:${w}px;height:${h}px;background:${BG};display:flex;align-items:center;justify-content:center">${sized(mark, tile)}</div>`);
  }
}
{
  const [w, h] = [480, 320];
  const tile = Math.round(h * 0.28);
  await png(`${RES}/drawable/splash.png`, w, h,
    `<div style="width:${w}px;height:${h}px;background:${BG};display:flex;align-items:center;justify-content:center">${sized(mark, tile)}</div>`);
}
await browser.close();

await writeFile(`${RES}/values/ic_launcher_background.xml`,
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${AMBER}</color>\n</resources>\n`);
process.stdout.write(`Android icons and launch screens written to ${RES}\n`);
