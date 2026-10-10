import { afterEach, describe, expect, it } from 'vitest';
import { isIOS, trackAppHeight } from '../../src/lib/appHeight';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Version/26.0 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/26.0 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/129.0 Mobile';

describe('app height', () => {
  afterEach(() => document.documentElement.style.removeProperty('--app-height'));

  it('knows the iPhone and the iPad (which says it is a Mac)', () => {
    expect(isIOS(IPHONE, 5)).toBe(true);
    expect(isIOS(IPAD, 5)).toBe(true);
    expect(isIOS(IPAD, 0)).toBe(false); // a Mac
    expect(isIOS(ANDROID, 5)).toBe(false);
  });

  it('follows the visible height on the iPhone, and lets go on cleanup', () => {
    const stop = trackAppHeight(IPHONE, 5);
    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe(`${window.innerHeight}px`);
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 700 });
    window.dispatchEvent(new Event('resize'));
    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('700px');
    stop();
    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('');
  });

  it('changes nothing elsewhere', () => {
    trackAppHeight(ANDROID, 5)();
    trackAppHeight(ANDROID, 5);
    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('');
  });
});
