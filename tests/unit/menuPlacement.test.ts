import { describe, expect, it } from 'vitest';
import { horizontalPlacement, opensUp } from '../../src/lib/menuPlacement';

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

  // "Mai multe" on a 320 px phone: a 240 px menu.
  it('grows leftwards under a button at the right edge', () => {
    expect(horizontalPlacement({ left: 200, right: 304 }, 240, 320, { preferRight: true })).toEqual({ left: 64, maxWidth: 288 });
  });

  it('grows rightwards under a button at the left edge (it would leave the screen leftwards)', () => {
    expect(horizontalPlacement({ left: 16, right: 120 }, 240, 320, { preferRight: true }).left).toBe(16);
  });

  it('a button in the middle with room on neither side: kept whole inside the margins', () => {
    const { left } = horizontalPlacement({ left: 110, right: 210 }, 280, 320, { preferRight: true });
    expect(left).toBeGreaterThanOrEqual(16);
    expect(left + 280).toBeLessThanOrEqual(304);
  });

  it('a menu wider than the screen gets the screen less the margins', () => {
    expect(horizontalPlacement({ left: 200, right: 300 }, 500, 320, { preferRight: true })).toEqual({ left: 16, maxWidth: 288 });
  });
});
