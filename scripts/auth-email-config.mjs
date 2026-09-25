// Prints the Supabase Management API body that installs the Auth email templates
// (supabase/templates) on the real project. Used by the "Deploy Supabase" Action:
//   node scripts/auth-email-config.mjs > auth.json
//   curl -X PATCH https://api.supabase.com/v1/projects/$REF/config/auth -d @auth.json …
// Plain JavaScript on purpose: it only reads the committed files.
//
// The templates point the wordmark image at the local stack's email-logo function; here that
// address becomes the project's (SUPABASE_PROJECT_REF, set by the Action).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'templates');
const subjects = JSON.parse(readFileSync(join(dir, 'subjects.json'), 'utf8'));
const LOCAL = 'http://127.0.0.1:54321';
const ref = process.env.SUPABASE_PROJECT_REF?.trim();
if (!ref) throw new Error('SUPABASE_PROJECT_REF is not set');
const html = (kind) => readFileSync(join(dir, `${kind}.html`), 'utf8').replaceAll(LOCAL, `https://${ref}.supabase.co`);

const body = {
  mailer_subjects_confirmation: subjects.confirmation,
  mailer_templates_confirmation_content: html('confirmation'),
  mailer_subjects_recovery: subjects.recovery,
  mailer_templates_recovery_content: html('recovery'),
  mailer_subjects_email_change: subjects.email_change,
  mailer_templates_email_change_content: html('email_change'),
  // Confirmation and reset links are valid 24 hours (ARCHITECTURE §15).
  mailer_otp_exp: 86400,
};
process.stdout.write(JSON.stringify(body));
