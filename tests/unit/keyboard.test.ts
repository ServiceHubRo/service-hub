import { afterEach, describe, expect, it } from 'vitest';
import { isTextField, keyboardOpen, resizeForKeyboard, watchKeyboard } from '../../src/lib/keyboard';

describe('keyboard', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('asks for a page resized by the keyboard on Android only, once', () => {
    const viewport = () => {
      document.head.innerHTML = '<meta name="viewport" content="width=device-width, initial-scale=1">';
      return document.head.querySelector('meta')!;
    };
    const android = viewport();
    resizeForKeyboard('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/129.0', document);
    resizeForKeyboard('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/129.0', document);
    expect(android.content).toBe('width=device-width, initial-scale=1, interactive-widget=resizes-content');
    const iphone = viewport();
    resizeForKeyboard('Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) Version/26.0 Mobile Safari/604.1', document);
    expect(iphone.content).toBe('width=device-width, initial-scale=1');
    document.head.innerHTML = '';
  });

  it('knows which fields bring up the keyboard', () => {
    const text = document.createElement('input');
    const box = document.createElement('input');
    box.type = 'checkbox';
    const area = document.createElement('textarea');
    const locked = document.createElement('textarea');
    locked.readOnly = true;
    expect(isTextField(text)).toBe(true);
    expect(isTextField(area)).toBe(true);
    expect(isTextField(box)).toBe(false);
    expect(isTextField(locked)).toBe(false);
    expect(isTextField(document.createElement('button'))).toBe(false);
    expect(isTextField(null)).toBe(false);
  });

  it('needs a real drop in height and a focused field', () => {
    expect(keyboardOpen(500, 800, true)).toBe(true);
    expect(keyboardOpen(740, 800, true)).toBe(false); // the address bar, not the keyboard
    expect(keyboardOpen(500, 800, false)).toBe(false); // the keyboard went, the page shrank otherwise
  });

  it('leaves the iPhone alone', () => {
    const stop = watchKeyboard('Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) Mobile Safari/604.1');
    const area = document.createElement('textarea');
    document.body.appendChild(area);
    area.focus();
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: window.innerHeight - 300 });
    window.dispatchEvent(new Event('resize'));
    expect(document.documentElement.hasAttribute('data-keyboard')).toBe(false);
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: window.innerHeight + 300 });
    stop();
  });

  it('marks <html data-keyboard> while it is open', () => {
    const area = document.createElement('textarea');
    document.body.appendChild(area);
    const stop = watchKeyboard('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/129.0 Mobile');
    area.focus();
    expect(document.documentElement.hasAttribute('data-keyboard')).toBe(false);
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: window.innerHeight - 300 });
    window.dispatchEvent(new Event('resize'));
    expect(document.documentElement.hasAttribute('data-keyboard')).toBe(true);
    stop();
    expect(document.documentElement.hasAttribute('data-keyboard')).toBe(false);
  });
});
