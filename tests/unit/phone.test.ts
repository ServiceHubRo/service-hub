import { describe, expect, it } from 'vitest';
import { phoneCountryOptions, phoneFromInput, phoneParts, PHONE_COUNTRIES } from '../../src/lib/phone';

describe('phone with a country', () => {
  it('keeps the Romanian rules: 07…, +40…, with or without the first 0', () => {
    expect(phoneFromInput('RO', '0723 375 248')).toBe('+40723375248');
    expect(phoneFromInput('RO', '723 375 248')).toBe('+40723375248');
    expect(phoneFromInput('RO', '+40 723-375-248')).toBe('+40723375248');
    expect(phoneFromInput('RO', '0268 312 445')).toBe('+40268312445');
    expect(phoneFromInput('RO', '0123 456 789')).toBeNull();
    expect(phoneFromInput('RO', '123')).toBeNull();
    expect(phoneFromInput('RO', '')).toBeNull();
  });

  it('takes other countries, dropping the trunk 0 (not in Italy)', () => {
    expect(phoneFromInput('DE', '0151 2345 6789')).toBe('+4915123456789');
    expect(phoneFromInput('MD', '069 123 456')).toBe('+37369123456');
    expect(phoneFromInput('HU', '06 30 123 4567')).toBe('+36301234567');
    expect(phoneFromInput('IT', '06 1234 5678')).toBe('+390612345678');
    expect(phoneFromInput('GB', '07700 900123')).toBe('+447700900123');
    expect(phoneFromInput('DE', '123')).toBeNull();
    expect(phoneFromInput('DE', '0151 2345 6789 0123 4')).toBeNull();
  });

  it('a number typed with + or 00 keeps its own country, whatever is chosen', () => {
    expect(phoneFromInput('RO', '+49 151 23456789')).toBe('+4915123456789');
    expect(phoneFromInput('DE', '0040 723 375 248')).toBe('+40723375248');
    expect(phoneFromInput('DE', '+40 123')).toBeNull();
  });

  it('splits a stored number back for editing', () => {
    expect(phoneParts('+40723375248')).toEqual({ country: 'RO', national: '0723 375 248' });
    expect(phoneParts('+4915123456789')).toEqual({ country: 'DE', national: '15123456789' });
    expect(phoneParts('+37369123456')).toEqual({ country: 'MD', national: '69123456' });
    expect(phoneParts(null)).toEqual({ country: 'RO', national: '' });
    expect(phoneFromInput(phoneParts('+4915123456789').country, phoneParts('+4915123456789').national)).toBe('+4915123456789');
  });

  it('lists Romania first, then the countries by name, in the app language', () => {
    const ro = phoneCountryOptions('ro');
    expect(ro[0]).toMatchObject({ code: 'RO', dial: '40', name: 'România' });
    expect(ro.length).toBe(PHONE_COUNTRIES.length);
    expect(new Set(ro.map((c) => c.code)).size).toBe(ro.length);
    const names = ro.slice(1).map((c) => c.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'ro')));
    expect(phoneCountryOptions('en').find((c) => c.code === 'DE')!.name).toBe('Germany');
  });
});
