// The Supabase Auth emails (ARCHITECTURE §15): confirmation (also "Retrimite"), password reset and
// email change, in the Service-Hub look, Romanian or US English by the account's language.
//
// Supabase Auth fills Go templates, so each email is one template holding both languages:
// `.Data.lang` is the account language (sign-up metadata, kept in step with the profile by the
// profiles_sync_lang trigger). `printf "%v"` keeps an account without the field on Romanian.
//
// This file is the source; `node scripts/build-auth-templates.mjs` writes supabase/templates/
// (read by the local stack through config.toml and sent to the real project by the "Deploy
// Supabase" Action). A unit test fails when the written files are out of date.
import { renderLayout, type Layout } from './emails.ts';

export type AuthEmailKind = 'confirmation' | 'recovery' | 'email_change';
export const AUTH_EMAIL_KINDS: readonly AuthEmailKind[] = ['confirmation', 'recovery', 'email_change'];

interface Variant {
  subject: string;
  layout: Omit<Layout, 'lang'>;
}

const LINK = '{{ .ConfirmationURL }}';

const TEXTS: Record<AuthEmailKind, { ro: Variant; en: Variant }> = {
  confirmation: {
    ro: {
      subject: 'Confirmă adresa de email',
      layout: {
        preheader: 'Un pas până la primul tău cont Service-Hub.',
        title: 'Confirmă-ți emailul',
        blocks: [
          { p: 'Bine ai venit pe Service-Hub. Apasă butonul ca să confirmi adresa {{ .Email }}.' },
          { p: 'Linkul merge o singură dată, timp de 24 de ore.' },
        ],
        button: { label: 'Confirmă adresa', url: LINK },
        footer: 'Dacă nu ți-ai făcut cont pe Service-Hub, ignoră acest email.',
      },
    },
    en: {
      subject: 'Confirm your email address',
      layout: {
        preheader: 'One step to your Service-Hub account.',
        title: 'Confirm your email',
        blocks: [
          { p: 'Welcome to Service-Hub. Tap the button to confirm {{ .Email }}.' },
          { p: 'The link works once, for 24 hours.' },
        ],
        button: { label: 'Confirm my email', url: LINK },
        footer: "If you didn't sign up for Service-Hub, ignore this email.",
      },
    },
  },
  recovery: {
    ro: {
      subject: 'Resetează parola Service-Hub',
      layout: {
        preheader: 'Alege o parolă nouă pentru contul tău.',
        title: 'Parolă nouă',
        blocks: [
          { p: 'Ai cerut o parolă nouă pentru contul {{ .Email }}. Apasă butonul și alege-o.' },
          { p: 'Linkul merge o singură dată. Dacă nu ai cerut tu, ignoră emailul: parola rămâne aceeași.' },
        ],
        button: { label: 'Alege parola nouă', url: LINK },
        footer: 'Primești acest email pentru că cineva a cerut resetarea parolei pe Service-Hub.',
      },
    },
    en: {
      subject: 'Reset your Service-Hub password',
      layout: {
        preheader: 'Choose a new password for your account.',
        title: 'New password',
        blocks: [
          { p: 'You asked for a new password for {{ .Email }}. Tap the button to choose it.' },
          { p: "The link works once. If you didn't ask for this, ignore this email: your password stays the same." },
        ],
        button: { label: 'Choose a new password', url: LINK },
        footer: 'You are receiving this email because someone asked to reset a Service-Hub password.',
      },
    },
  },
  email_change: {
    ro: {
      subject: 'Confirmă noua adresă de email',
      layout: {
        preheader: 'Confirmă schimbarea adresei contului Service-Hub.',
        title: 'Schimbi adresa de email',
        blocks: [
          { p: 'Ai cerut să schimbi adresa contului Service-Hub din {{ .Email }} în {{ .NewEmail }}. Apasă butonul ca să confirmi.' },
          { p: 'Până confirmi, contul folosește adresa veche.' },
        ],
        button: { label: 'Confirmă schimbarea', url: LINK },
        footer: 'Dacă nu ai cerut tu schimbarea, ignoră emailul și schimbă-ți parola.',
      },
    },
    en: {
      subject: 'Confirm your new email address',
      layout: {
        preheader: 'Confirm the new address of your Service-Hub account.',
        title: 'Changing your email',
        blocks: [
          { p: 'You asked to change your Service-Hub address from {{ .Email }} to {{ .NewEmail }}. Tap the button to confirm.' },
          { p: 'Until you confirm, the account keeps the old address.' },
        ],
        button: { label: 'Confirm the change', url: LINK },
        footer: "If you didn't ask for this change, ignore this email and change your password.",
      },
    },
  },
};

const IS_EN = '{{ if eq (printf "%v" .Data.lang) "en" }}';

/** The Go template of the subject: English for English accounts, else Romanian. */
export function authEmailSubject(kind: AuthEmailKind): string {
  return `${IS_EN}${TEXTS[kind].en.subject}{{ else }}${TEXTS[kind].ro.subject}{{ end }}`;
}

/** The Go template of the email body (a whole HTML document per language). */
export function authEmailHtml(kind: AuthEmailKind): string {
  const en = renderLayout({ lang: 'en', ...TEXTS[kind].en.layout });
  const ro = renderLayout({ lang: 'ro', ...TEXTS[kind].ro.layout });
  return `${IS_EN}${en}\n{{ else }}${ro}\n{{ end }}\n`;
}

/** Plain subjects, for tests and for the fallback when a subject cannot be a template. */
export function authEmailSubjects(kind: AuthEmailKind): { ro: string; en: string } {
  return { ro: TEXTS[kind].ro.subject, en: TEXTS[kind].en.subject };
}
