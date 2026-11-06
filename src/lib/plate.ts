/**
 * License plates (M7, Eduard 6 Nov 2026): one rule for the whole app, the mirror of `plate_norm()` and
 * `plate_valid()` in the database (migration plate_rule; the same vectors in tests/unit/plate.test.ts
 * and tests/sql/142_plate_rule.sql).
 *
 * The canonical plate: upper case, without whitespace and ASCII punctuation (spaces, dashes, dots,
 * underscores, slashes) and the middle dot. Letters with diacritics and other alphabets stay as typed.
 * `BV98LGY`, `BV-98-LGY`, `bv 98 lgy`, `B V 98 L G Y` → `BV98LGY`.
 */
const SEPARATORS = /[\s!-/:-@[-`{-~·]/g;

/** The canonical plate, '' when nothing is left. */
export function canonicalPlate(plate: string | null | undefined): string {
  return (plate ?? '').replace(SEPARATORS, '').toUpperCase();
}

const PLATE = /^[0-9A-ZÀ-ɏͰ-ϿЀ-ӿ]{2,10}$/u;

/**
 * A plate someone types: 2–10 letters or digits once the separators are gone, with at least one
 * digit. Romanian plates (`B 123 ABC`, `BV 98 LGY`, red and temporary ones) and foreign ones pass;
 * a word, a single character or a long code does not.
 */
export function isValidPlate(plate: string): boolean {
  const c = canonicalPlate(plate);
  return PLATE.test(c) && /[0-9]/.test(c);
}
