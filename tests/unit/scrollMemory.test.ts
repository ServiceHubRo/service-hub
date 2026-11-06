import { describe, expect, it } from 'vitest';
import { isUnaskedJump } from '../../src/lib/scrollMemory';

describe('a jump to the top nobody asked for', () => {
  const base = { top: 0, last: 1200, now: 10_000, disturbedAt: 9_500, touchedAt: 2_000 };

  it('right after coming back, untouched: undone', () => {
    expect(isUnaskedJump(base)).toBe(true);
  });
  it('the person scrolled or tapped just before: kept', () => {
    expect(isUnaskedJump({ ...base, touchedAt: 9_400 })).toBe(false);
  });
  it('long after coming back: kept', () => {
    expect(isUnaskedJump({ ...base, disturbedAt: 7_000 })).toBe(false);
  });
  it('never left the page: kept', () => {
    expect(isUnaskedJump({ ...base, disturbedAt: -Infinity })).toBe(false);
  });
  it('not at the top, or it was near the top anyway: kept', () => {
    expect(isUnaskedJump({ ...base, top: 300 })).toBe(false);
    expect(isUnaskedJump({ ...base, last: 40 })).toBe(false);
  });
});
