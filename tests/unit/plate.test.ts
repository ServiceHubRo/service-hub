import { describe, expect, it } from 'vitest';
import { canonicalPlate, isValidPlate } from '../../src/lib/plate';
import { normalizePlate as historyPlate, vehicleKey } from '../../src/lib/history';
import { normalizePlate as validatorPlate } from '../../src/lib/validators';

// The same vectors as tests/sql/142_plate_rule.sql (plate_norm / plate_valid in the database).
const SAME = ['BV98LGY', 'BV-98-LGY', 'bv98lgy', 'bv-98-lgy', 'BV 98 LGY', 'B V 98 L G Y', 'BV.98.LGY', ' bv_98/lgy '];

describe('license plates (M7)', () => {
  it('every way of writing BV 98 LGY is one canonical plate', () => {
    for (const p of SAME) expect(canonicalPlate(p)).toBe('BV98LGY');
  });

  it('the history, the validators and the identity check use the same rule', () => {
    for (const p of SAME) {
      expect(historyPlate(p)).toBe('BV98LGY');
      expect(validatorPlate(p)).toBe('BV98LGY');
      expect(vehicleKey({ plate: p })).toBe('plate:BV98LGY');
    }
  });

  it('letters with diacritics stay as typed (a foreign plate keeps its identity)', () => {
    expect(canonicalPlate('tü-ab 123')).toBe('TÜAB123');
    expect(canonicalPlate('M·AB 1234')).toBe('MAB1234');
  });

  it('Romanian and foreign plates are valid', () => {
    for (const p of ['B 123 ABC', 'B 12 ABC', 'BV 98 LGY', 'B 012345', 'CD 123 456', 'MAI 12345', 'M-AB 1234', 'TÜ-AB 123', 'AB 123 CD', '1234 ABC']) {
      expect(isValidPlate(p), p).toBe(true);
    }
  });

  it('a word, a single character, a long code or symbols are not plates', () => {
    for (const p of ['', 'X', 'ABCDEF', 'BV98LGY12345', '€123', '1', 'ab😀12']) {
      expect(isValidPlate(p), p).toBe(false);
    }
  });
});
