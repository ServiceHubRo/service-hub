/** Where a pop-up menu opens (MenuButton). */

/** What can be seen: the window, less the bars fixed at its top (header) and bottom (tab bar). */
export function visibleArea(): { top: number; bottom: number } {
  const vv = window.visualViewport;
  let top = vv ? vv.offsetTop : 0;
  let bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
  for (const bar of document.querySelectorAll<HTMLElement>('[data-fixed-top]')) {
    const r = bar.getBoundingClientRect();
    if (r.height > 0 && r.bottom > top) top = r.bottom;
  }
  for (const bar of document.querySelectorAll<HTMLElement>('[data-fixed-bottom]')) {
    const r = bar.getBoundingClientRect();
    if (r.height > 0 && r.top < bottom) bottom = r.top;
  }
  return { top, bottom };
}

/** Upwards when the menu does not fit under the button but fits above it. */
export function opensUp(button: { top: number; bottom: number }, menuHeight: number, bottom: number, top: number): boolean {
  const gap = 4;
  return button.bottom + gap + menuHeight > bottom && button.top - gap - menuHeight >= top;
}
