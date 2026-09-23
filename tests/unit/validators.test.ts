import { describe, expect, it } from 'vitest';
import vectors from '../fixtures/validator-vectors.json';
import {
  formatPhone,
  isValidCui,
  isValidIban,
  isValidPostalCode,
  isValidRegCom,
  isValidVin,
  normalizeCode,
  normalizePhone,
  normalizePlate,
} from '../../src/lib/validators';

// The same vectors run against the SQL validators in tests/sql/10_validators.sql.
const cases = [
  ['CUI', vectors.cui, isValidCui],
  ['Trade Register', vectors.regcom, isValidRegCom],
  ['IBAN', vectors.iban, isValidIban],
  ['postal code', vectors.postal_code, isValidPostalCode],
  ['VIN', vectors.vin, isValidVin],
] as const;

describe.each(cases)('%s', (_name, set, validate) => {
  it.each(set.valid)('accepts %j', (value) => expect(validate(value)).toBe(true));
  it.each(set.invalid)('refuses %j', (value) => expect(validate(value)).toBe(false));
});

describe('phone', () => {
  it.each(vectors.phone.valid)('normalizes %j to %j', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });
  it.each(vectors.phone.invalid)('refuses %j', (input) => expect(normalizePhone(input)).toBeNull());
  it('formats for display', () => {
    expect(formatPhone('+40723375248')).toBe('0723 375 248');
    expect(formatPhone('0268-312-445')).toBe('0268 312 445');
    expect(formatPhone('not a phone')).toBe('not a phone');
  });
});

describe('normalizers', () => {
  it('stores codes upper-case without spaces', () => {
    expect(normalizeCode(' ro 14872301 ')).toBe('RO14872301');
    expect(normalizeCode('   ')).toBeNull();
  });
  it('normalizes plates for matching', () => {
    expect(normalizePlate('bv-12 abc')).toBe('BV12ABC');
    expect(normalizePlate(' - ')).toBeNull();
  });
});
