// The consistency report (docs/MODEL_DE_FOLOSIRE.md): reads the rows the visual audit wrote
// (visual-audit/rows-*.jsonl, with `fields` and `patterns`) and writes a Markdown report, rule by rule:
// how many screens break it, in which accounts, and what exactly.
//
//   node scripts/consistency-report.mjs [visual-audit] [docs/AUDIT_CONSISTENTA.md]
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const dir = process.argv[2] ?? 'visual-audit';
const out = process.argv[3] ?? `${dir}/consistency.md`;

const rows = readdirSync(dir)
  .filter((f) => f.startsWith('rows-') && f.endsWith('.jsonl'))
  .flatMap((f) => readFileSync(`${dir}/${f}`, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)))
  .filter((r) => r.patterns || r.fields);

const ROLE = {
  visitor: 'Vizitator',
  client: 'Client',
  'client-nou': 'Client nou',
  'firma-admin': 'Firmă (administrator)',
  'firma-manager': 'Firmă (manager)',
  'firma-sofer': 'Firmă (șofer)',
  'firma-contabil': 'Firmă (contabil)',
  service: 'Service',
  'service-nou': 'Service nou',
  'service-coleg': 'Coleg de service',
  suport: 'Agent de suport',
  admin: 'Admin',
};

const RULES = {
  P1: 'Titlul ecranului e în antetul comun',
  P2: '„Înapoi” e linkul comun',
  P3: 'Ce arată lista: file sau listă de ales, nu bule',
  P4: 'Butoanele sunt butonul comun',
  P5: 'Un singur buton plin pe ecran',
  P6: 'Câmpurile sunt câmpul comun',
  P7: 'Starea e eticheta comună',
  P8: 'O listă e din rânduri sau carduri egale, nu carduri unul sub altul',
  P9: '„Se încarcă” e forma gri comună',
  P10: '„Mai multe” e meniul comun',
  P11: 'Confirmările și formularele se deschid în pagină, nu în fereastră',
  P12: 'Adăugarea e în dreapta sus (în antet sau în capul secțiunii)',
  F1: 'Câmpurile de pe un rând au aceeași lățime',
  F2: 'Câmpurile unul sub altul au aceleași margini',
  F3: 'Câmpurile de pe un rând au aceeași înălțime',
  F4: 'Câmpul nu iese din card',
  F5: 'Textul din câmp are cel puțin 16 px',
  F6: 'Fiecare câmp are etichetă',
  F7: 'Eticheta începe unde începe caseta',
};

/** The findings in plain Romanian (the measurements are written in English, like the code). */
const RO = [
  [/ is not in the page header$/, ' nu e în antetul comun'],
  [/^no title \(h1\) on the screen$/, 'ecranul nu are titlu'],
  [/^(\d+) titles \(h1\)$/, '$1 titluri'],
  [/ is not the shared back link$/, ' nu e linkul comun'],
  [/^chips: /, 'bule: '],
  [/^tabs built by hand: /, 'file făcute separat: '],
  [/ is a button built by hand inside (.+)$/, ' e un buton făcut separat (în $1)'],
  [/ is a button built by hand$/, ' e un buton făcut separat'],
  [/^more than one filled \(amber\) button on the screen$/, 'mai multe butoane pline pe ecran'],
  [/^(\d+) filled buttons$/, '$1 butoane pline'],
  [/ is built by hand$/, ' e un câmp făcut separat'],
  [/ uses StatusBadge, not StatusPill$/, ' are eticheta de stare veche (StatusBadge)'],
  [/ is a pill built by hand$/, ' e o etichetă făcută separat'],
  [/ is not top right$/, ' nu e în dreapta sus'],
  [/^(\d+) cards one after another \((.*)\): a list built from cards$/, '$1 carduri unul sub altul ($2)'],
  [/^a loading state that is not the skeleton.*$/, 'o stare „se încarcă” făcută separat'],
  [/ opens a menu built by hand$/, ' deschide un meniu făcut separat'],
  [/^a dialog: /, 'fereastră peste pagină: '],
  [/ ends at (\d+), (.+) at (\d+)$/, ' se termină la $1 px, $2 la $3 px'],
  [/ outside its box /, ' iese din cardul '],
  [/ has no label$/, ' nu are etichetă'],
  [/ label at (\d+), field at (\d+)$/, ': eticheta la $1 px, caseta la $2 px'],
];
const ro = (detail) => RO.reduce((d, [re, to]) => d.replace(re, to), detail);

/** Screens only in test builds (the component gallery, the template samples): not part of the app. */
const devOnly = (r) => r.path?.startsWith('/dev/');
/** The visitor's pages (landing, sign-in, legal) keep their own layout (docs/SABLOANE_HARTA.md). */
const outsideTemplates = (r, code) => r.role === 'visitor' && ['P1', 'P2', 'P7', 'P12'].includes(code);

/** Each screen by its Romanian title (the English pass of the same screen joins it). */
const titles = new Map();
for (const r of rows) if (r.lang === 'ro' && r.h1 && !titles.has(`${r.role}/${r.screen}`)) titles.set(`${r.role}/${r.screen}`, r.h1);

/** rule code -> detail -> set of "role · screen" (with the widths). */
const byRule = new Map();
const note = (code, detail, r) => {
  if (!byRule.has(code)) byRule.set(code, new Map());
  const details = byRule.get(code);
  const where = `${ROLE[r.role] ?? r.role} · ${titles.get(`${r.role}/${r.screen}`) || r.h1 || r.screen}`;
  if (!details.has(detail)) details.set(detail, new Map());
  const places = details.get(detail);
  if (!places.has(where)) places.set(where, new Set());
  places.get(where).add(`${r.width}${r.lang === 'en' ? ' EN' : ''}`);
};
/** P8: cards one under another on a laptop too (a grid of cards becomes one column on a phone). */
const listOnDesktop = new Set(
  rows.filter((r) => r.width >= 1024).flatMap((r) => (r.patterns?.findings ?? []).filter((f) => f.rule.startsWith('P8')).map((f) => `${r.role}/${r.screen}|${f.detail}`)),
);
for (const r of rows) {
  if (devOnly(r)) continue;
  for (const f of [...(r.patterns?.findings ?? []), ...(r.fields ?? [])]) {
    const code = f.rule.split(' ')[0];
    if (code === 'P8' && !listOnDesktop.has(`${r.role}/${r.screen}|${f.detail}`)) continue;
    if (!outsideTemplates(r, code)) note(code, f.detail, r);
  }
}

// Sizes: what most screens use, and where something else is used.
const tally = (pick) => {
  const all = new Map();
  for (const r of rows) for (const [k, n] of Object.entries(pick(r) ?? {})) all.set(k, (all.get(k) ?? 0) + n);
  return [...all.entries()].sort((a, b) => b[1] - a[1]);
};
const buttonHeights = tally((r) => r.patterns?.buttonHeights);
const fieldHeights = tally((r) => r.patterns?.fieldHeights);
const cards = tally((r) => r.patterns?.cards);
const headings = new Map();
for (const r of rows) {
  for (const [level, sizes] of Object.entries(r.patterns?.headings ?? {})) {
    for (const s of sizes) {
      const key = `${level} ${s}`;
      if (!headings.has(key)) headings.set(key, new Set());
      headings.get(key).add(`${ROLE[r.role] ?? r.role} · ${r.screen}`);
    }
  }
}

const screens = new Set(rows.filter((r) => !devOnly(r)).map((r) => `${r.role}/${r.screen}`));
const lines = [];
lines.push('# Auditul de consecvență');
lines.push('');
lines.push(`Regulile: \`docs/MODEL_DE_FOLOSIRE.md\`. Măsurat: ${screens.size} ecrane și stări, ${rows.length} vederi (fiecare ecran la fiecare lățime).`);
lines.push('');
lines.push('## Pe scurt');
lines.push('');
lines.push('| Regula | Ecrane cu abateri | Abateri diferite |');
lines.push('|---|---|---|');
for (const code of Object.keys(RULES)) {
  const details = byRule.get(code);
  const places = new Set();
  for (const m of details?.values() ?? []) for (const w of m.keys()) places.add(w);
  lines.push(`| ${code} ${RULES[code]} | ${places.size} | ${details?.size ?? 0} |`);
}
lines.push('');
for (const code of Object.keys(RULES)) {
  const details = byRule.get(code);
  if (!details?.size) continue;
  lines.push(`## ${code} — ${RULES[code]}`);
  lines.push('');
  // Screen by screen: what is different there, at which widths. English only when it differs from Romanian.
  const byScreen = new Map();
  for (const [detail, places] of details) {
    for (const [where, widths] of places) {
      const ws = [...widths];
      const roWidths = ws.filter((w) => !w.endsWith('EN'));
      if (roWidths.length === 0 && [...details.values()].some((p) => p.get(where) && [...p.get(where)].some((w) => !w.endsWith('EN')))) continue;
      if (!byScreen.has(where)) byScreen.set(where, []);
      byScreen.get(where).push(`${ro(detail)} (${(roWidths.length ? roWidths : ws).join(', ')} px${roWidths.length ? '' : ', doar în engleză'})`);
    }
  }
  for (const [where, found] of [...byScreen.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`- **${where}**: ${found.slice(0, 4).join('; ')}${found.length > 4 ? `; și încă ${found.length - 4}` : ''}`);
  }
  lines.push('');
}
lines.push('## Mărimi');
lines.push('');
lines.push(`- Înălțimea butoanelor (px: de câte ori): ${buttonHeights.map(([k, n]) => `${k}: ${n}`).join(', ')}`);
lines.push(`- Înălțimea câmpurilor pe un rând (px: de câte ori): ${fieldHeights.map(([k, n]) => `${k}: ${n}`).join(', ')}`);
lines.push(`- Cardurile (colțuri, spațiu interior: de câte ori): ${cards.map(([k, n]) => `${k}: ${n}`).join(', ')}`);
lines.push('- Titlurile (mărime/grosime → ecrane):');
for (const [k, where] of [...headings.entries()].sort()) {
  const list = [...where];
  lines.push(`  - ${k}: ${list.length} ecrane${list.length <= 6 ? ` (${list.join('; ')})` : ''}`);
}
lines.push('');
writeFileSync(out, `${lines.join('\n')}\n`);
console.warn(`consistency report: ${out}`);
