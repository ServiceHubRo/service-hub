import { describe, expect, it } from 'vitest';
import { en } from '../../src/i18n/en';
import { formatDate, formatKm, formatMoney, formatRelativeDays, formatTime, ymdInBucharest } from '../../src/i18n/format';
import { ro } from '../../src/i18n/ro';
import { detectLang, interpolate, plural, translate } from '../../src/i18n/translate';

describe('dictionaries', () => {
  it('en has exactly the keys of ro, none empty', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ro).sort());
    for (const [key, value] of Object.entries(en)) expect(value, key).not.toBe('');
  });

  it('English copy uses US spelling', () => {
    const text = Object.values(en).join(' ');
    for (const british of ['tyre', 'colour', 'licence', 'cancelled', 'catalogue', 'windscreen']) {
      expect(text.toLowerCase()).not.toContain(british);
    }
  });
});

describe('detectLang', () => {
  it('uses the stored choice first', () => {
    expect(detectLang('en', 'ro-RO')).toBe('en');
    expect(detectLang('ro', 'en-US')).toBe('ro');
  });
  it('falls back to the browser language', () => {
    expect(detectLang(null, 'ro-RO')).toBe('ro');
    expect(detectLang(null, 'ro')).toBe('ro');
    expect(detectLang(null, 'de-DE')).toBe('en');
    expect(detectLang('xx', undefined)).toBe('en');
  });
});

describe('translate', () => {
  it('interpolates parameters and keeps unknown ones', () => {
    expect(interpolate('{a} și {b}', { a: 1 })).toBe('1 și {b}');
    expect(translate('ro', 'demo.actionDone', { n: 3 })).toBe('Trimiteri: 3');
    expect(translate('en', 'status.cancelled')).toBe('Canceled');
  });

  it('pluralizes Romanian days as 1 / 2–19 / 20+ de', () => {
    expect(plural('ro', 'unit.days', 1)).toBe('1 zi');
    expect(plural('ro', 'unit.days', 2)).toBe('2 zile');
    expect(plural('ro', 'unit.days', 19)).toBe('19 zile');
    expect(plural('ro', 'unit.days', 20)).toBe('20 de zile');
    expect(plural('en', 'unit.days', 1)).toBe('1 day');
    expect(plural('en', 'unit.days', 20)).toBe('20 days');
  });
});

describe('formatters', () => {
  it('formats money', () => {
    expect(formatMoney('ro', 1250)).toBe('1.250 lei');
    expect(formatMoney('en', 1250)).toBe('1,250 RON');
    expect(formatMoney('ro', 80)).toBe('80 lei');
    expect(formatMoney('ro', 99.5)).toBe('99,50 lei');
  });

  it('formats km', () => {
    expect(formatKm('ro', 105400)).toBe('105.400 km');
    expect(formatKm('en', 105400)).toBe('105,400 km');
  });

  it('formats booking dates', () => {
    expect(formatDate('ro', '2026-10-14')).toBe('Mie 14 oct');
    expect(formatDate('en', '2026-10-14')).toBe('Wed, Oct 14');
  });

  it('shows times in Bucharest, not the device zone', () => {
    // 06:00 UTC in October (summer time, UTC+3) is 09:00 in Bucharest.
    expect(formatTime('ro', new Date('2026-10-14T06:00:00Z'))).toBe('09:00');
    // 07:00 UTC in December (UTC+2) is 09:00 in Bucharest.
    expect(formatTime('en', new Date('2026-12-14T07:00:00Z'))).toBe('09:00');
    // 22:30 UTC is already the next day in Bucharest.
    expect(ymdInBucharest(new Date('2026-10-14T22:30:00Z'))).toBe('2026-10-15');
  });

  it('counts relative days in Bucharest calendar days', () => {
    const now = new Date('2026-10-14T21:30:00Z'); // 00:30 on Oct 15 in Bucharest
    expect(formatRelativeDays('ro', '2026-10-15', now)).toBe('azi');
    expect(formatRelativeDays('ro', '2026-10-16', now)).toBe('mâine');
    expect(formatRelativeDays('ro', '2026-10-27', now)).toBe('în 12 zile');
    expect(formatRelativeDays('en', '2026-10-12', now)).toBe('3 days ago');
  });
});
