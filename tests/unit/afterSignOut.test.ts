import { describe, expect, it } from 'vitest';
import { markSigningOut, takeOpenAtTop } from '../../src/lib/afterSignOut';

describe('the public page after signing out (Eduard, 13 Nov 2026)', () => {
  it('opens at the top once, only after signing out', () => {
    expect(takeOpenAtTop()).toBe(false);
    markSigningOut();
    expect(takeOpenAtTop()).toBe(true);
    // A reload, back or forward afterwards: the browser's own place.
    expect(takeOpenAtTop()).toBe(false);
  });
});
