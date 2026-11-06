import { describe, expect, it } from 'vitest';
import { en } from '../../src/i18n/en';
import { FORBIDDEN_EN, FORBIDDEN_RO, type ForbiddenRule } from '../../src/i18n/glossary';
import { ro } from '../../src/i18n/ro';

// The editorial standard (docs/EDITORIAL.md, src/i18n/glossary.ts) checked on every text source:
// the app's strings, the notifications, the emails, the SMS and the PDFs. A new text that breaks
// it fails here, with the key (or file) and what to write instead.

/** Keys whose value is not prose a user reads as Service-Hub's voice. */
const EXEMPT = new Set([
  // The user's own voice (a choice they make, a statement they tick, a message they send).
  'auth.roleClient',
  'auth.roleShop',
  'auth.termsBefore',
  'account.delete.understand',
  'booking.ack.label',
  'report.waiver',
  'lk.signin',
  'help.whatsappText',
  'ref.message',
  'friend.message',
  // Developer-facing build diagnostics (preview links only).
  'schema.noConfig',
  'schema.unreachable',
]);

/** Shared prefixes of developer-only screens (component gallery, design preview). */
const EXEMPT_PREFIX = ['dev.', 'gallery.demo', 'fleet.preview.'];

function offences(texts: Record<string, string>, rules: readonly ForbiddenRule[]): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(texts)) {
    if (EXEMPT.has(key) || EXEMPT_PREFIX.some((p) => key.startsWith(p))) continue;
    for (const rule of rules) {
      if (rule.pattern.test(value)) out.push(`${key}: “${value}” — ${rule.why}; write: ${rule.instead}`);
    }
  }
  return out;
}

/** The prose literals of a server source file: quoted strings with at least two words. */
const SOURCES = import.meta.glob<string>(
  '../../supabase/functions/_shared/{templates,emails,authEmails,sms,report,jobDoc,emailButtonLabels,accountDeletion}.ts',
  { query: '?raw', import: 'default', eager: true },
);

function literals(path: string, raw: string): Record<string, string> {
  const src = raw
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Record<string, string> = {};
  const rx = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = rx.exec(src))) {
    const text = (m[1] ?? m[2] ?? m[3] ?? '').replace(/\$\{[^}]*\}/g, 'X').replace(/\{[a-z_]+\}/g, 'X');
    // Prose only: letters and spaces, no markup, CSS or code.
    if (!/[A-Za-zĂÂÎȘȚăâîșț]{3,} [A-Za-zĂÂÎȘȚăâîșț]{2,}/.test(text) || /[<>{};=]|!important|https?:/.test(text)) continue;
    out[`${path}#${++i}`] = text;
  }
  return out;
}


describe('editorial standard', () => {
  it('the Romanian app texts follow it', () => {
    expect(offences(ro, FORBIDDEN_RO)).toEqual([]);
  });

  it('the English app texts follow it', () => {
    expect(offences(en, FORBIDDEN_EN)).toEqual([]);
  });

  it('notifications, emails, SMS and documents follow it', () => {
    const files = Object.entries(SOURCES);
    expect(files).toHaveLength(8);
    const all = Object.assign({}, ...files.map(([path, raw]) => literals(path, raw))) as Record<string, string>;
    expect(offences(all, [...FORBIDDEN_RO, ...FORBIDDEN_EN])).toEqual([]);
  });

  it('the same situation is worded the same way on every screen', () => {
    const wrong: string[] = [];
    // Named like an action but not one: a field label, a selling point, a specific step, a check.
    const notTheAction = new Set(['rules.cancel', 'sub.feature.cancel', 'reports.retry', 'mfa.loadError']);
    for (const key of Object.keys(ro) as (keyof typeof ro)[]) {
      if (notTheAction.has(key)) continue;
      const r = ro[key];
      const e = en[key];
      const last = key.split('.').pop() ?? '';
      // A cancel button: „Renunță” closes without a change, „Anulează …” cancels something that exists.
      if (last === 'cancel' && !(r === 'Renunță' || r.startsWith('Anulează'))) wrong.push(`${key}: ${r}`);
      if (last === 'retry' && r !== 'Încearcă din nou') wrong.push(`${key}: ${r}`);
      // A load error: „… nu s-a(u) încărcat.” / “… could not be loaded.”
      if (/^(loadError|[a-z]+LoadError)$/.test(last)) {
        if (!/nu s-a(u)? încărcat\./.test(r)) wrong.push(`${key}: ${r}`);
        if (!/could not be loaded\./.test(e)) wrong.push(`${key}: ${e}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('one label per action: the shared buttons keep the glossary verbs', () => {
    expect([ro['common.save'], ro['common.cancel'], ro['action.retry']]).toEqual(['Salvează', 'Renunță', 'Încearcă din nou']);
    expect([en['common.save'], en['common.cancel'], en['action.retry']]).toEqual(['Save', 'Cancel', 'Try again']);
  });
});
