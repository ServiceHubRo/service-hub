import { Capacitor } from '@capacitor/core';

/** The keyboard handling here is the Android app's only: the site and the iPhone are left as they are. */
export const IN_ANDROID_APP = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

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

/** True when `height` is far enough below the tallest height seen at this width. */
export function keyboardOpen(height: number, tallest: number, focused: boolean): boolean {
  return focused && tallest - height >= KEYBOARD_MIN_PX;
}

/**
 * Marks `<html data-keyboard>` while the keyboard is open, so the bottom bar steps aside and the
 * screen being typed in keeps the room. Should the phone lay the keyboard over the page instead of
 * making it shorter, `--keyboard-cover` on <html> holds how much it covers (0 when the page was made
 * shorter), and the shell leaves that room (AppShell.module.css). Returns the cleanup.
 */
export function watchKeyboard(): () => void {
  const viewport = window.visualViewport;
  const tallest = new Map<number, number>();
  const update = () => {
    const width = Math.round(window.innerWidth);
    const height = Math.round(viewport?.height ?? window.innerHeight);
    const before = tallest.get(width) ?? 0;
    if (height > before) tallest.set(width, height);
    const open = keyboardOpen(height, Math.max(before, height), isTextField(document.activeElement));
    const root = document.documentElement;
    root.toggleAttribute('data-keyboard', open);
    const cover = open && viewport ? Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop)) : 0;
    if (cover > 0) root.style.setProperty('--keyboard-cover', `${cover}px`);
    else root.style.removeProperty('--keyboard-cover');
  };
  update();
  const target = viewport ?? window;
  target.addEventListener('resize', update);
  // The keyboard can stay while the focus moves (or go while it stays): checked again then.
  // After a focusout the next field may take the focus at once: no flash of the bar in between.
  let timer = 0;
  const later = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(update, 0);
  };
  document.addEventListener('focusin', update);
  document.addEventListener('focusout', later);
  return () => {
    window.clearTimeout(timer);
    target.removeEventListener('resize', update);
    document.removeEventListener('focusin', update);
    document.removeEventListener('focusout', later);
    document.documentElement.removeAttribute('data-keyboard');
    document.documentElement.style.removeProperty('--keyboard-cover');
  };
}
