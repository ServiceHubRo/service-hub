import { describe, expect, it } from 'vitest';
import { opensUp } from '../../src/lib/menuPlacement';

describe('menu placement', () => {
  // A 390 px phone: header to 60, tab bar from 760.
  const menu = 2 * 44 + 10;

  it('opens downwards when the menu fits above the tab bar', () => {
    expect(opensUp({ top: 300, bottom: 344 }, menu, 760, 60)).toBe(false);
  });

  it('opens upwards on the last card, where the tab bar would hide the menu', () => {
    expect(opensUp({ top: 690, bottom: 734 }, menu, 760, 60)).toBe(true);
  });

  it('stays downwards when it fits on neither side (the page then scrolls)', () => {
    expect(opensUp({ top: 100, bottom: 144 }, 900, 760, 60)).toBe(false);
  });
});
