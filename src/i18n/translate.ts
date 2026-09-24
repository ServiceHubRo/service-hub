import { en } from './en';
import { ro, type MessageKey } from './ro';

export type Lang = 'ro' | 'en';
export type Params = Record<string, string | number>;

const dictionaries: Record<Lang, Record<MessageKey, string>> = { ro, en };

export const LANG_STORAGE_KEY = 'sh_lang';

/** `navigator.language` starting with "ro" → Romanian, anything else → English (ARCHITECTURE §15). */
export function detectLang(stored: string | null, browserLang: string | undefined): Lang {
  if (stored === 'ro' || stored === 'en') return stored;
  return browserLang?.toLowerCase().startsWith('ro') ? 'ro' : 'en';
}

export function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

export function translate(lang: Lang, key: MessageKey, params?: Params): string {
  return interpolate(dictionaries[lang][key], params);
}

type PluralBase =
  | 'unit.days'
  | 'unit.hours'
  | 'unit.shops'
  | 'unit.reviews'
  | 'unit.services'
  | 'unit.places'
  | 'unit.savedCars';
const pluralRules: Record<Lang, Intl.PluralRules> = {
  ro: new Intl.PluralRules('ro-RO'),
  en: new Intl.PluralRules('en-US'),
};

/** RO: 1 zi / 2–19 zile / 20+ de zile. EN: 1 day / other days. */
export function plural(lang: Lang, base: PluralBase, n: number): string {
  const category = pluralRules[lang].select(n);
  const form = category === 'one' ? 'one' : category === 'few' ? 'few' : 'other';
  return translate(lang, `${base}.${form}` as MessageKey, { n });
}
