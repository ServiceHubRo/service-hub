import { afterEach, describe, expect, it } from 'vitest';
import { fieldArea, isTextField, keyboardOpen, opensKeyboard, resizeForKeyboard, scrollToShow, visibleBand, watchKeyboard } from '../../src/lib/keyboard';

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

  it('a drop-down list takes the keyboard\'s place too (the iPhone\'s wheel); a disabled one does not', () => {
    const select = document.createElement('select');
    expect(opensKeyboard(select)).toBe(true);
    select.disabled = true;
    expect(opensKeyboard(select)).toBe(false);
    expect(opensKeyboard(document.createElement('textarea'))).toBe(true);
    expect(opensKeyboard(document.createElement('button'))).toBe(false);
  });

  it('what is seen with the keyboard open: the visual viewport, below the header while it is on screen', () => {
    // iPhone 390 × 664 (Safari with its bars), keyboard 300 px: 364 px seen, page not scrolled.
    expect(visibleBand({ offsetTop: 0, height: 364 }, 664, 60)).toEqual({ top: 60, bottom: 364 });
    // The browser panned the visible part down by 200 px: the header is above it, out of sight.
    expect(visibleBand({ offsetTop: 200, height: 364 }, 664, 60)).toEqual({ top: 200, bottom: 564 });
    // No visualViewport (an old browser): the window.
    expect(visibleBand(null, 600, 0)).toEqual({ top: 0, bottom: 600 });
  });

  it('scrolls only as far as needed to see the field, never when it is already seen', () => {
    const band = { top: 60, bottom: 364 };
    expect(scrollToShow({ top: 120, bottom: 170 }, band)).toBe(0);
    // Under the keyboard: up to a third of the way down what is seen.
    const down = scrollToShow({ top: 500, bottom: 550 }, band);
    expect(down).toBeGreaterThan(0);
    expect(500 - down).toBe(60 + Math.round((304 - 50) / 3));
    // Under the header: down to the same place.
    expect(scrollToShow({ top: 20, bottom: 70 }, band)).toBe(20 - (60 + Math.round((304 - 50) / 3)));
    // A text area taller than what is seen: its top under the header, with a margin.
    expect(scrollToShow({ top: 400, bottom: 800 }, band)).toBe(400 - 60 - 16);
  });

  it('a field is shown with its label just above it', () => {
    document.body.innerHTML = '<label for="f">Descriere</label><textarea id="f"></textarea>';
    const field = document.getElementById('f')!;
    const label = document.querySelector('label')!;
    const box = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 100, width: 100, height: bottom - top, x: 0, y: top, toJSON: () => ({}) });
    field.getBoundingClientRect = () => box(300, 400) as DOMRect;
    label.getBoundingClientRect = () => box(270, 290) as DOMRect;
    expect(fieldArea(field)).toEqual({ top: 270, bottom: 400 });
    // A label far above (another layout): the field alone.
    label.getBoundingClientRect = () => box(100, 120) as DOMRect;
    expect(fieldArea(field)).toEqual({ top: 300, bottom: 400 });
    document.body.innerHTML = '';
  });

  it('a drop-down list with the keyboard\'s height open hides the bottom bar too', () => {
    const select = document.createElement('select');
    document.body.appendChild(select);
    const stop = watchKeyboard();
    select.focus();
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: window.innerHeight - 260 });
    window.dispatchEvent(new Event('resize'));
    expect(document.documentElement.hasAttribute('data-keyboard')).toBe(true);
    stop();
    select.remove();
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
