import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isNewBookingForShop } from '../../supabase/functions/_shared/templates';

// T47: the new-booking chime. Which notifications ring with it, and the per-device switch.

describe('which notifications ring with the new-booking chime', () => {
  it('a new request or a booking confirmed at once, for the shop only', () => {
    expect(isNewBookingForShop({ event: 'booking_requested', role: 'shop' })).toBe(true);
    expect(isNewBookingForShop({ event: 'booking_auto_confirmed', role: 'shop' })).toBe(true);
    expect(isNewBookingForShop({ event: 'booking_requested', role: 'client' })).toBe(false);
    expect(isNewBookingForShop({ event: 'quote_accepted', role: 'shop' })).toBe(false);
    expect(isNewBookingForShop({ event: 'new_message', role: 'shop' })).toBe(false);
  });
});

describe('the chime on this device', () => {
  let started: number;

  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    started = 0;
    // A browser that lets the page play sound: one decoded sound, sources counted when started.
    class FakeContext {
      state = 'running';
      destination = {};
      resume = () => Promise.resolve();
      decodeAudioData = () => Promise.resolve({ duration: 1.25 });
      createBufferSource = () => ({ buffer: null, connect: () => undefined, start: () => (started += 1) });
    }
    vi.stubGlobal('AudioContext', FakeContext);
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(new ArrayBuffer(8)))));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('is on until turned off, and the choice stays on the device', async () => {
    const chime = await import('../../src/lib/chime');
    expect(chime.chimeOn()).toBe(true);
    chime.setChimeOn(false);
    expect(chime.chimeOn()).toBe(false);
    expect(localStorage.getItem('sh_sound_off')).toBe('1');
    chime.setChimeOn(true);
    expect(localStorage.getItem('sh_sound_off')).toBeNull();
  });

  it('rings once for several requests in a moment; not at all when off; "Ascultă" always', async () => {
    const chime = await import('../../src/lib/chime');
    expect(await chime.playChime()).toBe(true);
    expect(await chime.playChime()).toBe(false); // the same moment: one ring
    expect(started).toBe(1);
    chime.setChimeOn(false);
    vi.useFakeTimers({ now: Date.now() + 5000, toFake: ['Date'] });
    expect(await chime.playChime()).toBe(false);
    expect(await chime.playChime(true)).toBe(true);
    expect(started).toBe(2);
  });

  it('a browser without sound plays nothing and says so', async () => {
    vi.stubGlobal('AudioContext', undefined);
    const chime = await import('../../src/lib/chime');
    expect(await chime.playChime(true)).toBe(false);
  });
});
