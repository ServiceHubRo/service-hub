import { formatPhone as formatRomanian, normalizePhone as normalizeRomanian } from './validators';

/**
 * Phone numbers with a country (sign-up and Cont): Romania first and strict (`+40` + 9 digits, as
 * before), the other countries loosely (the digits after the country code, 6–12 of them, a leading
 * trunk 0 dropped). Stored in the international form (`+40723375248`, `+4915123456789`).
 * Country names come from the browser (Intl.DisplayNames), in the app's language.
 */
export interface PhoneCountry {
  /** ISO 3166 code: `RO`, `DE`… */
  code: string;
  /** Country calling code without `+`: `40`, `49`… */
  dial: string;
}

/** Romania, the EU, its neighbours and the countries most drivers in Romania come from. */
export const PHONE_COUNTRIES: readonly PhoneCountry[] = [
  { code: 'RO', dial: '40' },
  { code: 'MD', dial: '373' },
  { code: 'AT', dial: '43' },
  { code: 'BE', dial: '32' },
  { code: 'BG', dial: '359' },
  { code: 'HR', dial: '385' },
  { code: 'CY', dial: '357' },
  { code: 'CZ', dial: '420' },
  { code: 'DK', dial: '45' },
  { code: 'EE', dial: '372' },
  { code: 'FI', dial: '358' },
  { code: 'FR', dial: '33' },
  { code: 'DE', dial: '49' },
  { code: 'GR', dial: '30' },
  { code: 'HU', dial: '36' },
  { code: 'IE', dial: '353' },
  { code: 'IT', dial: '39' },
  { code: 'LV', dial: '371' },
  { code: 'LT', dial: '370' },
  { code: 'LU', dial: '352' },
  { code: 'MT', dial: '356' },
  { code: 'NL', dial: '31' },
  { code: 'PL', dial: '48' },
  { code: 'PT', dial: '351' },
  { code: 'SK', dial: '421' },
  { code: 'SI', dial: '386' },
  { code: 'ES', dial: '34' },
  { code: 'SE', dial: '46' },
  { code: 'GB', dial: '44' },
  { code: 'CH', dial: '41' },
  { code: 'NO', dial: '47' },
  { code: 'IS', dial: '354' },
  { code: 'UA', dial: '380' },
  { code: 'RS', dial: '381' },
  { code: 'ME', dial: '382' },
  { code: 'MK', dial: '389' },
  { code: 'AL', dial: '355' },
  { code: 'BA', dial: '387' },
  { code: 'TR', dial: '90' },
  { code: 'US', dial: '1' },
  { code: 'AU', dial: '61' },
];

export const DEFAULT_PHONE_COUNTRY = 'RO';

function countryOf(code: string): PhoneCountry {
  return PHONE_COUNTRIES.find((c) => c.code === code) ?? PHONE_COUNTRIES[0]!;
}

/** The country whose calling code starts these digits (the longest one that fits). */
function countryByDigits(digits: string): PhoneCountry | null {
  let best: PhoneCountry | null = null;
  for (const c of PHONE_COUNTRIES) if (digits.startsWith(c.dial) && (!best || c.dial.length > best.dial.length)) best = c;
  return best;
}

/** Countries sorted by name in the app's language, Romania first. */
export function phoneCountryOptions(lang: string): { code: string; dial: string; name: string }[] {
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames([lang === 'en' ? 'en-US' : 'ro-RO'], { type: 'region' });
  } catch {
    names = null;
  }
  const named = PHONE_COUNTRIES.map((c) => ({ ...c, name: names?.of(c.code) ?? c.code }));
  const [first, ...rest] = named;
  return [first!, ...rest.sort((a, b) => a.name.localeCompare(b.name, lang === 'en' ? 'en' : 'ro'))];
}

/**
 * What the person typed, for the chosen country, as an international number; null when it is not
 * one. A number typed with `+` or `00` keeps its own country code.
 */
export function phoneFromInput(countryCode: string, value: string): string | null {
  const text = value.trim();
  const international = text.startsWith('+') || text.startsWith('00');
  const digits = text.replace(/\D/g, '').replace(/^00/, '');
  if (!digits) return null;

  let country: PhoneCountry | null;
  let national: string;
  if (international) {
    country = countryByDigits(digits);
    if (!country) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
    national = digits.slice(country.dial.length);
  } else {
    country = countryOf(countryCode);
    national = digits;
  }

  if (country.code === 'RO') return normalizeRomanian(national.startsWith('0') ? national : `0${national}`);
  // The trunk prefix before a national number: 0, 06 in Hungary, none in Italy (part of the number).
  if (country.code === 'HU') national = national.replace(/^06/, '');
  else if (country.code !== 'IT') national = national.replace(/^0/, '');
  if (!/^\d{6,12}$/.test(national) || country.dial.length + national.length > 15) return null;
  return `+${country.dial}${national}`;
}

/** A stored number split back for editing: its country and the national part as it is shown. */
export function phoneParts(stored: string | null | undefined): { country: string; national: string } {
  const value = (stored ?? '').trim();
  if (!value) return { country: DEFAULT_PHONE_COUNTRY, national: '' };
  if (normalizeRomanian(value)) return { country: 'RO', national: formatRomanian(value) };
  const digits = value.replace(/\D/g, '');
  const country = value.startsWith('+') ? countryByDigits(digits) : null;
  if (!country) return { country: DEFAULT_PHONE_COUNTRY, national: value };
  return { country: country.code, national: digits.slice(country.dial.length) };
}
