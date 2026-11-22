import { en } from './en';
import { ro, type MessageKey } from './ro';

export type Lang = 'ro' | 'en';
export type Params = Record<string, string | number>;

/**
 * A message kept in state as its key (and values), not as a sentence, so it is translated when shown
 * and follows a language switch.
 */
export interface Msg {
  key: MessageKey;
  params?: Params;
}

const dictionaries: Record<Lang, Record<MessageKey, string>> = { ro, en };

export const LANG_STORAGE_KEY = 'sh_lang';

/**
 * Romanian unless the person chose English (stored): the browser's language no longer decides — a visitor
 * whose browser is in English saw English everywhere, then a tour in English (Eduard, 22 Nov 2026: „set
 * default to Romanian; if someone needs English, they'll switch”).
 */
export function detectLang(stored: string | null): Lang {
  return stored === 'en' ? 'en' : 'ro';
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

export type PluralUnit =
  | 'unit.days'
  | 'unit.procedures'
  | 'unit.months'
  | 'unit.hours'
  | 'unit.minutes'
  | 'unit.shops'
  | 'unit.reviews'
  | 'unit.services'
  | 'unit.servicesTicked'
  | 'unit.places'
  | 'unit.photos'
  | 'unit.savedCars'
  | 'unit.cars'
  | 'unit.rows'
  | 'unit.values'
  | 'unit.quotes'
  | 'unit.newRequests'
  | 'unit.quotesToDecide'
  | 'unit.unreadConversations'
  | 'unit.repairs'
  | 'unit.jobs'
  | 'unit.bookings'
  | 'unit.freeReports'
  | 'unit.friends'
  | 'unit.trialLeft'
  | 'unit.clients'
  | 'unit.reportsPending'
  | 'unit.disputesPending'
  | 'unit.subscriptions'
  | 'unit.reports'
  | 'unit.people'
  | 'unit.colleagues'
  | 'unit.articles';
const pluralRules: Record<Lang, Intl.PluralRules> = {
  ro: new Intl.PluralRules('ro-RO'),
  en: new Intl.PluralRules('en-US'),
};

/** RO: 1 zi / 2–19 zile / 20+ de zile. EN: 1 day / other days. */
export function plural(lang: Lang, base: PluralUnit, n: number): string {
  const category = pluralRules[lang].select(n);
  const form = category === 'one' ? 'one' : category === 'few' ? 'few' : 'other';
  return translate(lang, `${base}.${form}` as MessageKey, { n });
}
