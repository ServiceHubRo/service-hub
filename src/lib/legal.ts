import company from '../../docs/legal/company.json';
import type { MessageKey } from '../i18n/ro';
import type { Lang } from '../i18n/translate';
import { CONTACT } from './contact';
import { formatPhone } from './validators';

/**
 * Version of the Terms and Privacy Policy a new account accepts (stored on the profile as
 * terms_version + terms_accepted_at). Change it whenever docs/legal changes in substance.
 */
export const TERMS_VERSION = '2026-09-25';

export type LegalDocId = 'termeni' | 'confidentialitate' | 'cookies';

export const LEGAL_DOCS: { id: LegalDocId; titleKey: MessageKey }[] = [
  { id: 'termeni', titleKey: 'legal.terms' },
  { id: 'confidentialitate', titleKey: 'legal.privacy' },
  { id: 'cookies', titleKey: 'legal.cookies' },
];

export function isLegalDocId(value: string | undefined): value is LegalDocId {
  return value === 'termeni' || value === 'confidentialitate' || value === 'cookies';
}

/**
 * The operator's data the documents quote as `{{field}}`. The company's own details live in
 * docs/legal/company.json (empty until Eduard sends them: the documents then show a visible
 * "to be filled in" mark); the email and phone are the ones on the landing page.
 */
export const LEGAL_FIELDS = ['company', 'address', 'regcom', 'cui', 'email', 'phone'] as const;
export type LegalField = (typeof LEGAL_FIELDS)[number];

export function isLegalField(key: string): key is LegalField {
  return (LEGAL_FIELDS as readonly string[]).includes(key);
}

export function legalFieldValues(): Record<LegalField, string> {
  return {
    company: company.company.trim(),
    address: company.address.trim(),
    regcom: company.regcom.trim(),
    cui: company.cui.trim(),
    email: CONTACT.email,
    phone: formatPhone(CONTACT.phone),
  };
}

/** The document in the reader's language (the Romanian text is the one that applies). Loaded on demand. */
export async function loadLegalDoc(id: LegalDocId, lang: Lang): Promise<string> {
  if (lang === 'en') {
    switch (id) {
      case 'termeni':
        return (await import('../../docs/legal/en/1_Terms_and_Conditions.md?raw')).default;
      case 'confidentialitate':
        return (await import('../../docs/legal/en/2_Privacy_Policy.md?raw')).default;
      case 'cookies':
        return (await import('../../docs/legal/en/3_Cookie_Policy.md?raw')).default;
    }
  }
  switch (id) {
    case 'termeni':
      return (await import('../../docs/legal/1_Termeni_si_Conditii.md?raw')).default;
    case 'confidentialitate':
      return (await import('../../docs/legal/2_Politica_de_Confidentialitate_GDPR.md?raw')).default;
    case 'cookies':
      return (await import('../../docs/legal/3_Politica_de_Cookies.md?raw')).default;
  }
}
