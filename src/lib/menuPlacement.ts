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

/**
 * Where a menu starts horizontally, in window coordinates: on the side the button asks for (a small
 * "Mai multe" grows towards the left, under its right edge; a wide button keeps its left edge), else
 * on the other side, and always whole inside [margin, width - margin]. A menu wider than that room
 * gets the room's width (`maxWidth`), so its entries wrap instead of being cut.
 */
export function horizontalPlacement(
  button: { left: number; right: number },
  menuWidth: number,
  viewportWidth: number,
  options: { preferRight: boolean; margin?: number },
): { left: number; maxWidth: number } {
  const margin = options.margin ?? 16;
  const maxWidth = Math.max(0, viewportWidth - 2 * margin);
  const width = Math.min(menuWidth, maxWidth);
  const fromRight = button.right - width;
  const fromLeft = button.left;
  const fits = (left: number) => left >= margin && left + width <= viewportWidth - margin;
  const [first, second] = options.preferRight ? [fromRight, fromLeft] : [fromLeft, fromRight];
  const left = fits(first) ? first : fits(second) ? second : Math.min(Math.max(first, margin), viewportWidth - margin - width);
  return { left, maxWidth };
}
