import { Capacitor } from '@capacitor/core';
import { KEYBOARD_RESIZE } from './viewportMeta';

/** The Android app (its page gets shorter while the keyboard is open, resizeForKeyboard). */
export const IN_ANDROID_APP = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

/**
 * In the Android app the page itself gets shorter while the keyboard is open (instead of the
 * keyboard covering it). The app's build writes the setting into the page (vite.config.ts,
 * APP_PLATFORM=android); this adds it at start to an app built without it. Call once at start.
 */
export function resizeForKeyboard(inAndroidApp = IN_ANDROID_APP, doc: Document = document): void {
  if (!inAndroidApp) return;
  const meta = doc.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!meta || meta.content.includes('interactive-widget')) return;
  meta.content = `${meta.content}, ${KEYBOARD_RESIZE}`;
}

/**
 * The on-screen keyboard of a phone. A page cannot ask whether it is open, so the visible height
 * is compared with the tallest seen at the same width: a drop of KEYBOARD_MIN_PX or more while a
 * text field has the focus means the keyboard is up (the address bar hiding is far less).
 */
export const KEYBOARD_MIN_PX = 120;

/** A field that brings up the keyboard (not a checkbox, a button or a picker). */
export function isTextField(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly;
  if (el instanceof HTMLInputElement) {
    const nonText = ['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'file', 'color', 'image', 'hidden'];
    return !el.readOnly && !nonText.includes(el.type);
  }
  return el instanceof HTMLElement && el.isContentEditable === true;
}

/**
 * A field that takes the bottom of the screen while it has the focus: the keyboard, or on the
 * iPhone the wheel of a drop-down list (it takes the keyboard's place).
 */
export function opensKeyboard(el: Element | null): boolean {
  return isTextField(el) || (el instanceof HTMLSelectElement && !el.disabled);
}

/** True when `height` is far enough below the tallest height seen at this width. */
export function keyboardOpen(height: number, tallest: number, focused: boolean): boolean {
  return focused && tallest - height >= KEYBOARD_MIN_PX;
}

/** The part of the page the person sees, in the page's own coordinates (getBoundingClientRect). */
export interface Band {
  top: number;
  bottom: number;
}

/**
 * What is visible while the keyboard is open. On the iPhone the page keeps its height and the
 * keyboard covers its bottom: only the visual viewport (offsetTop, height) is seen. Safari also
 * moves that visible part down the page by itself (offsetTop); the header and „‹ Înapoi” follow it
 * (--vv-top, watchKeyboard), so they cover its top (navTop) wherever it is. The bottom bar is
 * hidden then (data-keyboard).
 */
export function visibleBand(viewport: { offsetTop: number; height: number } | null, innerHeight: number, navTop: number): Band {
  const top = viewport?.offsetTop ?? 0;
  return { top: top + navTop, bottom: top + (viewport?.height ?? innerHeight) };
}

/**
 * Kept free above the keyboard (Eduard, 13 Nov 2026, iPhone): Safari 26 shows its address bar just
 * above the keyboard, over the page (about 40 px on his screenshot), and a field needs a little air.
 */
export const KEYBOARD_GAP = 56;

/**
 * How far to scroll the page so the field is seen comfortably: 0 when it already is (`margin` below
 * the top, `bottomMargin` above the bottom); otherwise it goes a third of the way down what is
 * visible, or, taller than that, its top to the top (the caret of a long text stays where the
 * browser keeps it).
 */
export function scrollToShow(field: Band, band: Band, margin = 16, bottomMargin = margin): number {
  const room = band.bottom - band.top;
  const height = field.bottom - field.top;
  if (field.top >= band.top + margin && field.bottom <= band.bottom - bottomMargin) return 0;
  if (height + margin + bottomMargin >= room) return Math.round(field.top - band.top - margin);
  return Math.round(field.top - (band.top + Math.max(margin, Math.min((room - height) / 3, room - bottomMargin - height))));
}

/**
 * The room kept at the end of the page while the keyboard is open (--kb-room, global.css): on the
 * iPhone, where the keyboard covers the page instead of shortening it, enough for the last field
 * and the last button to be scrolled above the keyboard. Without it, at the end of a page the app
 * cannot scroll further: Safari then moves what is seen itself and the header slides away
 * (Eduard, 13 Nov 2026). Where the page itself got shorter (Android), the gap only.
 */
export function keyboardRoom(innerHeight: number, viewportHeight: number): number {
  return Math.max(0, Math.round(innerHeight - viewportHeight)) + KEYBOARD_GAP;
}

/**
 * Where the field goes with the keyboard open: with its label and the gap above the keyboard when
 * all fit; on a small phone the label first (a smaller gap), then the field alone.
 */
export function placeField(withLabel: Band, field: Band, band: Band): number {
  const room = band.bottom - band.top;
  const fits = (b: Band, gap: number) => b.bottom - b.top + 16 + gap <= room;
  if (fits(withLabel, KEYBOARD_GAP)) return scrollToShow(withLabel, band, 16, KEYBOARD_GAP);
  if (fits(withLabel, 16)) return scrollToShow(withLabel, band, 16, 16);
  return scrollToShow(field, band, 16, fits(field, KEYBOARD_GAP) ? KEYBOARD_GAP : 16);
}

/** The field with its label when the label is just above it (so the person sees what is asked). */
export function fieldArea(field: HTMLElement): Band {
  const rect = field.getBoundingClientRect();
  const label = (field as HTMLInputElement).labels?.[0]?.getBoundingClientRect();
  const top = label && label.bottom <= rect.top + 1 && rect.top - label.top < 80 ? label.top : rect.top;
  return { top, bottom: rect.bottom };
}

/** What stays at the top: the header (AppShell, --nav-top) and „‹ Înapoi” under it (BackLink, --back-bar). */
function navTopPx(): number {
  const style = getComputedStyle(document.documentElement);
  return (parseFloat(style.getPropertyValue('--nav-top')) || 0) + (parseFloat(style.getPropertyValue('--back-bar')) || 0);
}

/**
 * What scrolls to bring `field` into view: the page (null), or the area the field sits in — a
 * scrolling area of its own, or a window over the page (a dialog, something fixed), which the page's
 * scroll does not move (`scroller` is null when that window does not scroll).
 */
export function scrollHost(field: HTMLElement): { scroller: HTMLElement | null } | null {
  for (let el = field.parentElement; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
    const style = getComputedStyle(el);
    const scrolls = (style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1;
    if (scrolls) return { scroller: el };
    if (style.position === 'fixed' || el.tagName === 'DIALOG') return { scroller: null };
  }
  return null;
}

/** How much the visible height must change, with the same field in focus, for it to be placed again. */
export const KEYBOARD_REGROW_PX = 24;

/**
 * The phone's keyboard, on every platform — the iPhone's Safari, Android's browsers and the
 * Android app (Eduard, 11 Nov 2026: on the iPhone the bottom bar covered the form and its button).
 * While it is open, `<html data-keyboard>`: the bottom bar steps aside and what sticks to the
 * bottom (a main button, the box to write a message) goes back into the page, so nothing is held
 * behind the keyboard; the field being typed in is scrolled to where it is seen.
 *
 * The field is placed once: when the keyboard opens on it, when the focus moves to another field,
 * or when the keyboard itself grows — never again after the person has scrolled, until they choose
 * another field (Eduard, 13 Nov 2026: Safari reports a change of what is seen while the page is
 * scrolled, and every report put the field back, undoing the person's scroll). Returns the cleanup.
 */
export function watchKeyboard(): () => void {
  const viewport = window.visualViewport;
  const root = document.documentElement;
  const tallest = new Map<number, number>();
  let open = false;
  let showTimer = 0;
  /** The field the keyboard is open on, whether it still waits to be placed, and for which height. */
  let current: Element | null = null;
  let pending = false;
  let placedFor = 0;
  /** The person has scrolled since that field took the focus: the page is theirs. */
  let moved = false;
  /** When a field last took the focus and when the person last scrolled (the keyboard takes a moment to come). */
  let focusAt = 0;
  let gestureAt = 0;

  // The field in view, once the keyboard has taken its place (the browser's own scroll first).
  const show = () => {
    window.clearTimeout(showTimer);
    showTimer = window.setTimeout(() => {
      const field = document.activeElement;
      if (!open || !pending || moved || !(field instanceof HTMLElement) || !opensKeyboard(field)) return;
      pending = false;
      const host = scrollHost(field);
      // In a window over the page the header is behind it: the whole visible part counts.
      const band = visibleBand(viewport, window.innerHeight, host ? 0 : navTopPx());
      // With its label when both fit; the field alone (seen whole) when only it does.
      const delta = placeField(fieldArea(field), field.getBoundingClientRect(), band);
      if (delta === 0) return;
      const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      const how: ScrollToOptions = { top: delta, behavior: smooth ? 'smooth' : 'auto' };
      if (!host) window.scrollBy(how);
      else host.scroller?.scrollBy(how);
    }, 120);
  };

  // The person scrolls: nothing of ours moves the page after that.
  const byHand = (event: Event) => {
    gestureAt = event.timeStamp;
    if (!open) return;
    moved = true;
    pending = false;
    window.clearTimeout(showTimer);
  };

  // Where Safari has moved what is seen (the header and „‹ Înapoi” follow it), and the room at the
  // end of the page, while the keyboard is open; nothing otherwise.
  let frame = 0;
  const place = () => {
    window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(() => {
      if (!open) return;
      root.style.setProperty('--vv-top', `${Math.max(0, Math.round(viewport?.offsetTop ?? 0))}px`);
    });
  };

  const update = () => {
    const width = Math.round(window.innerWidth);
    // What is seen, whatever the zoom (a page zoomed in is not a keyboard).
    const height = Math.round(viewport ? viewport.height * viewport.scale : window.innerHeight);
    const before = tallest.get(width) ?? 0;
    if (height > before) tallest.set(width, height);
    // The tallest seen at this width, or the page's own height where the keyboard covers the page
    // instead of shortening it (the iPhone; also right after the phone is turned).
    const full = Math.max(before, height, Math.round(window.innerHeight));
    const active = document.activeElement;
    const now = keyboardOpen(height, full, opensKeyboard(active));
    if (now) root.style.setProperty('--kb-room', `${keyboardRoom(window.innerHeight, height)}px`);
    if (now !== open) {
      open = now;
      root.toggleAttribute('data-keyboard', open);
      current = null;
      if (!open) {
        window.cancelAnimationFrame(frame);
        window.clearTimeout(showTimer);
        pending = false;
        root.style.removeProperty('--vv-top');
        root.style.removeProperty('--kb-room');
      }
    }
    if (!open) return;
    place();
    if (active !== current) {
      // The keyboard opened on this field, or the focus moved to it („Next”, a tap).
      // Not when the person began to scroll while the keyboard was still coming.
      current = active;
      moved = gestureAt > focusAt;
      pending = !moved;
      placedFor = height;
    } else if (!moved && Math.abs(height - placedFor) >= KEYBOARD_REGROW_PX) {
      // The keyboard itself changed (its suggestions row, another keyboard) and the page is where we left it.
      pending = true;
      placedFor = height;
    }
    if (pending) show();
  };
  update();
  const target = viewport ?? window;
  target.addEventListener('resize', update);
  viewport?.addEventListener('scroll', place);
  window.addEventListener('touchmove', byHand, { passive: true });
  window.addEventListener('wheel', byHand, { passive: true });
  // The keyboard can stay while the focus moves (or go while it stays): checked again then.
  // After a focusout the next field may take the focus at once: no flash of the bar in between.
  let timer = 0;
  const later = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(update, 0);
  };
  const focused = (event: Event) => {
    focusAt = event.timeStamp;
    update();
  };
  document.addEventListener('focusin', focused);
  document.addEventListener('focusout', later);
  return () => {
    window.clearTimeout(timer);
    window.clearTimeout(showTimer);
    window.cancelAnimationFrame(frame);
    target.removeEventListener('resize', update);
    viewport?.removeEventListener('scroll', place);
    window.removeEventListener('touchmove', byHand);
    window.removeEventListener('wheel', byHand);
    document.removeEventListener('focusin', focused);
    document.removeEventListener('focusout', later);
    root.removeAttribute('data-keyboard');
    root.style.removeProperty('--vv-top');
    root.style.removeProperty('--kb-room');
  };
}
