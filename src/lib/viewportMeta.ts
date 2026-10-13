/** The viewport setting that makes the page shorter while the phone's keyboard is open. */
export const KEYBOARD_RESIZE = 'interactive-widget=resizes-content';

/** The page's HTML with the keyboard setting added to its viewport tag (once). */
export function withKeyboardResize(html: string): string {
  return html.replace(/(<meta\s+name="viewport"\s+content=")([^"]*)(")/, (all, start: string, content: string, end: string) =>
    content.includes('interactive-widget') ? all : `${start}${content}, ${KEYBOARD_RESIZE}${end}`,
  );
}
