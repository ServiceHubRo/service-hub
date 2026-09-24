import type { MessageKey } from '../i18n/ro';

/**
 * Version of the Terms and Privacy Policy a new account accepts (stored on the profile as
 * terms_version + terms_accepted_at). Change it whenever docs/legal changes in substance.
 */
export const TERMS_VERSION = '2026-09';

export type LegalDocId = 'termeni' | 'confidentialitate' | 'cookies';

export const LEGAL_DOCS: { id: LegalDocId; titleKey: MessageKey }[] = [
  { id: 'termeni', titleKey: 'legal.terms' },
  { id: 'confidentialitate', titleKey: 'legal.privacy' },
  { id: 'cookies', titleKey: 'legal.cookies' },
];

export function isLegalDocId(value: string | undefined): value is LegalDocId {
  return value === 'termeni' || value === 'confidentialitate' || value === 'cookies';
}

/** The Romanian text (English versions come before launch, T19). Loaded on demand. */
export async function loadLegalDoc(id: LegalDocId): Promise<string> {
  switch (id) {
    case 'termeni':
      return (await import('../../docs/legal/1_Termeni_si_Conditii.md?raw')).default;
    case 'confidentialitate':
      return (await import('../../docs/legal/2_Politica_de_Confidentialitate_GDPR.md?raw')).default;
    case 'cookies':
      return (await import('../../docs/legal/3_Politica_de_Cookies.md?raw')).default;
  }
}
