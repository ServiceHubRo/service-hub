import { describe, expect, it } from 'vitest';
import { withKeyboardResize } from '../../src/lib/viewportMeta';

describe('the Android app page', () => {
  const page = '<head><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" /></head>';

  it('asks for a page made shorter by the keyboard, written into the page', () => {
    expect(withKeyboardResize(page)).toContain(
      'content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content"',
    );
  });

  it('adds it once', () => {
    expect(withKeyboardResize(withKeyboardResize(page))).toBe(withKeyboardResize(page));
  });
});
