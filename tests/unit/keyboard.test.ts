import { afterEach, describe, expect, it, vi } from 'vitest';
import { KEYBOARD_GAP, KEYBOARD_REGROW_PX, fieldArea, isTextField, keyboardOpen, keyboardRoom, opensKeyboard, placeField, resizeForKeyboard, scrollHost, scrollToShow, visibleBand, watchKeyboard } from '../../src/lib/keyboard';

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
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: window.innerHeight + 300 });
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
    // Safari moved the visible part down by 200 px: the header follows it (--vv-top) and covers its top.
    expect(visibleBand({ offsetTop: 200, height: 364 }, 664, 60)).toEqual({ top: 260, bottom: 564 });
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
  it('keeps room at the end of the page while the keyboard is open (Eduard, 13 Nov 2026)', () => {
    // iPhone: the keyboard covers 336 px of a 664 px page: the keyboard and the gap.
    expect(keyboardRoom(664, 328)).toBe(336 + KEYBOARD_GAP);
    // Android (the page itself got shorter): the gap only.
    expect(keyboardRoom(328, 328)).toBe(KEYBOARD_GAP);
  });

  it('a field above the keyboard with a gap; the label kept first on a small phone', () => {
    const band = { top: 100, bottom: 400 };
    // Plenty of room: the field and its label above the gap.
    expect(placeField({ top: 470, bottom: 540 }, { top: 490, bottom: 540 }, band)).toBe(scrollToShow({ top: 470, bottom: 540 }, band, 16, KEYBOARD_GAP));
    // 130 px seen: the label and the field fit with a small gap, not with the full one.
    const small = { top: 100, bottom: 230 };
    const delta = placeField({ top: 300, bottom: 376 }, { top: 328, bottom: 376 }, small);
    expect(300 - delta).toBeGreaterThanOrEqual(116);
    expect(376 - delta).toBeLessThanOrEqual(230 - 16);
    // 90 px seen: the field alone.
    const tiny = { top: 100, bottom: 190 };
    const d = placeField({ top: 300, bottom: 376 }, { top: 328, bottom: 376 }, tiny);
    expect(328 - d).toBeGreaterThanOrEqual(116);
  });

  it('while the keyboard is open, the header follows what Safari shows and the page keeps room', () => {
    const area = document.createElement('textarea');
    document.body.appendChild(area);
    const raf = window.requestAnimationFrame;
    window.requestAnimationFrame = (cb) => {
      cb(0);
      return 0;
    };
    const stop = watchKeyboard();
    area.focus();
    const tall = window.innerHeight;
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: tall - 300 });
    window.dispatchEvent(new Event('resize'));
    const root = document.documentElement;
    expect(root.hasAttribute('data-keyboard')).toBe(true);
    expect(parseFloat(root.style.getPropertyValue('--kb-room'))).toBe(KEYBOARD_GAP); // no visualViewport here: the page itself got shorter
    expect(root.style.getPropertyValue('--vv-top')).toBe('0px');
    stop();
    expect(root.style.getPropertyValue('--kb-room')).toBe('');
    expect(root.style.getPropertyValue('--vv-top')).toBe('');
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: tall });
    window.requestAnimationFrame = raf;
  });
  describe('the page stays where the person put it (Eduard, 13 Nov 2026)', () => {
    const box = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 100, width: 100, height: bottom - top, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
    let tall = 0;
    let stop = () => {};
    let scrollBy: ReturnType<typeof vi.fn>;

    /** A field far below what is seen, with the keyboard open on it. */
    function openOn(id: string): HTMLElement {
      const field = document.createElement('input');
      field.id = id;
      field.getBoundingClientRect = () => box(900, 950);
      document.body.appendChild(field);
      field.focus();
      resize(tall - 300);
      return field;
    }
    function resize(height: number) {
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
      window.dispatchEvent(new Event('resize'));
    }

    function start() {
      vi.useFakeTimers();
      tall = window.innerHeight;
      scrollBy = vi.fn();
      window.scrollBy = scrollBy as unknown as typeof window.scrollBy;
      stop = watchKeyboard();
    }
    afterEach(() => {
      stop();
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: tall });
      vi.useRealTimers();
    });

    it('places the field once when the keyboard opens, not at every report of what is seen', () => {
      start();
      openOn('a');
      vi.advanceTimersByTime(200);
      expect(scrollBy).toHaveBeenCalledTimes(1);
      // Safari reports again (its bars move while the page is scrolled): nothing more.
      for (let i = 0; i < 5; i++) window.dispatchEvent(new Event('resize'));
      vi.advanceTimersByTime(500);
      expect(scrollBy).toHaveBeenCalledTimes(1);
    });

    it('never moves the page after the person scrolled, by touch or by wheel', () => {
      for (const gesture of ['touchmove', 'wheel']) {
        start();
        openOn(gesture);
        // Before the field was placed: the person is already scrolling.
        window.dispatchEvent(new Event(gesture));
        vi.advanceTimersByTime(500);
        expect(scrollBy, gesture).not.toHaveBeenCalled();
        // The keyboard grows afterwards: still theirs.
        resize(tall - 300 - 2 * KEYBOARD_REGROW_PX);
        vi.advanceTimersByTime(500);
        expect(scrollBy, gesture).not.toHaveBeenCalled();
        stop();
        document.body.innerHTML = '';
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: tall });
        vi.useRealTimers();
      }
    });

    it('leaves the page alone when the person scrolls while the keyboard is still coming', () => {
      start();
      const field = document.createElement('input');
      field.getBoundingClientRect = () => box(900, 950);
      document.body.appendChild(field);
      field.focus();
      vi.advanceTimersByTime(50);
      window.dispatchEvent(new Event('touchmove'));
      vi.advanceTimersByTime(200);
      resize(tall - 300);
      vi.advanceTimersByTime(500);
      expect(document.documentElement.hasAttribute('data-keyboard')).toBe(true);
      expect(scrollBy).not.toHaveBeenCalled();
    });

    it('places the next field when the focus moves („Next”), also after a scroll by hand', () => {
      start();
      openOn('a');
      vi.advanceTimersByTime(200);
      window.dispatchEvent(new Event('touchmove'));
      const next = document.createElement('textarea');
      next.getBoundingClientRect = () => box(1200, 1300);
      document.body.appendChild(next);
      next.focus();
      vi.advanceTimersByTime(200);
      expect(scrollBy).toHaveBeenCalledTimes(2);
      // Typing in it moves nothing.
      next.dispatchEvent(new Event('input', { bubbles: true }));
      vi.advanceTimersByTime(500);
      expect(scrollBy).toHaveBeenCalledTimes(2);
    });

    it('places the field again when the keyboard itself grows, the page untouched', () => {
      start();
      openOn('a');
      vi.advanceTimersByTime(200);
      resize(tall - 300 - KEYBOARD_REGROW_PX + 4); // a few pixels: not the keyboard
      vi.advanceTimersByTime(200);
      expect(scrollBy).toHaveBeenCalledTimes(1);
      resize(tall - 300 - 2 * KEYBOARD_REGROW_PX);
      vi.advanceTimersByTime(200);
      expect(scrollBy).toHaveBeenCalledTimes(2);
    });

    it('a field already seen is left where it is', () => {
      start();
      const field = openOn('a');
      field.getBoundingClientRect = () => box(30, 70);
      vi.advanceTimersByTime(200);
      expect(scrollBy).not.toHaveBeenCalled();
    });

    it('in a window over the page, that window scrolls, never the page behind it', () => {
      start();
      const overlay = document.createElement('div');
      overlay.style.position = 'fixed';
      overlay.style.overflowY = 'auto';
      Object.defineProperty(overlay, 'scrollHeight', { value: 2000 });
      Object.defineProperty(overlay, 'clientHeight', { value: 500 });
      const inner = vi.fn();
      overlay.scrollBy = inner as unknown as typeof overlay.scrollBy;
      const field = document.createElement('input');
      field.getBoundingClientRect = () => box(900, 950);
      overlay.appendChild(field);
      document.body.appendChild(overlay);
      expect(scrollHost(field)).toEqual({ scroller: overlay });
      field.focus();
      resize(tall - 300);
      vi.advanceTimersByTime(200);
      expect(inner).toHaveBeenCalledTimes(1);
      expect(scrollBy).not.toHaveBeenCalled();
      // A fixed window that does not scroll: nothing is moved.
      overlay.style.overflowY = 'visible';
      expect(scrollHost(field)).toEqual({ scroller: null });
      // In the page itself: the page.
      document.body.appendChild(field);
      expect(scrollHost(field)).toBeNull();
    });
  });

  it('the keyboard is known right after the phone is turned (the page keeps its height under it)', () => {
    const area = document.createElement('textarea');
    document.body.appendChild(area);
    const listeners = new Map<string, EventListener>();
    const vv = { height: 700, scale: 1, offsetTop: 0, addEventListener: (n: string, f: EventListener) => listeners.set(n, f), removeEventListener: () => {} };
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv });
    const inner = window.innerHeight;
    const width = window.innerWidth;
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 700 });
    const stop = watchKeyboard();
    area.focus();
    // Turned on its side with the keyboard open: a width never seen before, 200 of 390 px visible.
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 844 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 390 });
    vv.height = 200;
    listeners.get('resize')!(new Event('resize'));
    expect(document.documentElement.hasAttribute('data-keyboard')).toBe(true);
    // A page zoomed in twice, no keyboard: half the height seen is not a keyboard.
    vv.height = 195;
    vv.scale = 2;
    listeners.get('resize')!(new Event('resize'));
    expect(document.documentElement.hasAttribute('data-keyboard')).toBe(false);
    stop();
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: inner });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  });
});
