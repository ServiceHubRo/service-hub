// Writes the Supabase Auth email templates (supabase/templates/*.html and subjects.json) from
// supabase/functions/_shared/authEmails.ts. Run after changing the texts:
//   node scripts/build-auth-templates.mjs
// (Node 22 reads the TypeScript source directly.)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AUTH_EMAIL_KINDS,
  authEmailHtml,
  authEmailSubject,
} from '../supabase/functions/_shared/authEmails.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'supabase', 'templates');
mkdirSync(out, { recursive: true });

const subjects = {};
for (const kind of AUTH_EMAIL_KINDS) {
  writeFileSync(join(out, `${kind}.html`), authEmailHtml(kind));
  subjects[kind] = authEmailSubject(kind);
}
writeFileSync(join(out, 'subjects.json'), `${JSON.stringify(subjects, null, 2)}\n`);
process.stdout.write(`Wrote ${AUTH_EMAIL_KINDS.length} templates to supabase/templates/\n`);
