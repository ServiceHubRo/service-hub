// T46: the public page `/` drawn ahead, after `vite build`. Google, link previews and a slow
// phone get the text in the HTML itself; the browser takes over that HTML (src/main.tsx).
//
//   node scripts/prerender.mjs [outDir]      (default: dist)
//
// Writes <outDir>/index.html (the page drawn, with its canonical address and structured data)
// and <outDir>/app.html (the empty shell every other address gets, public/_redirects). The phone
// app (APP_PLATFORM=android) keeps the empty shell: it opens on the sign-in screen.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

const outDir = resolve(process.argv[2] ?? 'dist');
const shell = await readFile(join(outDir, 'index.html'), 'utf8');
await writeFile(join(outDir, 'app.html'), shell);

if (process.env.APP_PLATFORM === 'android') process.exit(0);

// Inside the project, so the drawing code finds React and the rest in node_modules.
const cache = resolve('node_modules/.cache');
await mkdir(cache, { recursive: true });
const ssrDir = await mkdtemp(join(cache, 'sh-prerender-'));
try {
  await build({
    logLevel: 'warn',
    build: { ssr: 'src/prerender.tsx', outDir: ssrDir, emptyOutDir: true, sourcemap: false, copyPublicDir: false },
  });
  const { renderPage, headTags } = await import(pathToFileURL(join(ssrDir, 'prerender.js')).href);
  const page = renderPage('/');
  if (!page.includes('<h1')) throw new Error('prerender: the public page has no heading; nothing was written');
  const ROOT = '<div id="root"></div>';
  if (!shell.includes(ROOT)) throw new Error(`prerender: ${ROOT} not found in index.html`);
  // Functions, not strings: a `$` in the page is text, never a replacement pattern.
  const html = shell
    .replace('</head>', () => `${headTags()}\n  </head>`)
    .replace(ROOT, () => `<div id="root" data-prerendered="">${page}</div>`);
  await writeFile(join(outDir, 'index.html'), html);
  process.stdout.write(`prerender: / written to ${join(outDir, 'index.html')} (${Math.round(html.length / 1024)} kB)\n`);
} finally {
  await rm(ssrDir, { recursive: true, force: true });
}
