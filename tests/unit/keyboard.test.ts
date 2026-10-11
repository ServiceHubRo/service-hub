import { afterEach, describe, expect, it } from 'vitest';
import { isTextField, keyboardOpen, resizeForKeyboard, watchKeyboard } from '../../src/lib/keyboard';

describe('keyboard', () => {
  afterEach(() => {
    document.body.innerHTML = '';
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

  it('marks <html data-keyboard> while it is open', () => {
    const area = document.createElement('textarea');
    document.body.appendChild(area);
    const stop = watchKeyboard();
    area.focus();
    expect(document.documentElement.hasAttribute('data-keyboard')).toBe(false);
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: window.innerHeight - 300 });
    window.dispatchEvent(new Event('resize'));
    expect(document.documentElement.hasAttribute('data-keyboard')).toBe(true);
    stop();
    expect(document.documentElement.hasAttribute('data-keyboard')).toBe(false);
  });

  it('asks for a page made shorter by the keyboard in the Android app only, once', () => {
    document.head.innerHTML = '<meta name="viewport" content="width=device-width, initial-scale=1">';
    const meta = document.head.querySelector('meta')!;
    resizeForKeyboard(false, document);
    expect(meta.content).toBe('width=device-width, initial-scale=1');
    resizeForKeyboard(true, document);
    resizeForKeyboard(true, document);
    expect(meta.content).toBe('width=device-width, initial-scale=1, interactive-widget=resizes-content');
    document.head.innerHTML = '';
  });
});
