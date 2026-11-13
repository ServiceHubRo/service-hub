import { APP_RELEASE } from './env';
import { fieldArea, navTopPx, opensKeyboard, placeField, scrollHost, seenTop, visibleBand } from './keyboard';

/**
 * The keyboard's measurements, on screen (test builds only, opened with `?kb=1`; main.tsx).
 * Eduard, 13 Nov 2026: Safari on his iPhone left the field under the keyboard although the played
 * keyboard of the tests passed. A test browser has no real keyboard, so the real numbers are read
 * on the phone itself: he takes a screenshot with the keyboard open and the strip shows what Safari
 * reports (the heights, where it moved the view), what the app worked out from it and in what
 * order things happened. Numbers and codes only, for whoever reads the screenshot; nothing is sent.
 */
export function showKeyboardReadout(): () => void {
  const vv = window.visualViewport;
  const root = document.documentElement;
  const strip = document.createElement('pre');
  strip.setAttribute('aria-hidden', 'true');
  Object.assign(strip.style, {
    position: 'fixed',
    left: '0',
    right: '0',
    top: '0',
    zIndex: '2147483646',
    margin: '0',
    padding: '2px 6px',
    font: '10px/1.25 ui-monospace, Menlo, monospace',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    color: '#9dff8a',
    background: 'rgba(0, 0, 0, 0.88)',
    pointerEvents: 'none',
  });
  document.body.appendChild(strip);
  // The safe areas as the browser resolves them (its top padding and its bottom padding).
  const safe = document.createElement('i');
  Object.assign(safe.style, { position: 'fixed', left: '0', top: '0', width: '0', height: '0', visibility: 'hidden' });
  safe.style.setProperty('border-top', 'env(safe-area-inset-top, 0px) solid transparent');
  safe.style.setProperty('border-bottom', 'env(safe-area-inset-bottom, 0px) solid transparent');
  document.body.appendChild(safe);

  // What happened, in order, since the last field took the focus (ms after it).
  let start = performance.now();
  let events: string[] = [];
  let first: string[] = [];
  const note = (text: string) => {
    const line = `+${Math.round(performance.now() - start)} ${text}`;
    // The first ones (how the keyboard came) and the last ones (where things ended).
    if (first.length < 12) first.push(line);
    else events.push(line);
    if (events.length > 12) events = events.slice(-12);
  };
  const r = Math.round;

  const onFocus = (event: Event) => {
    start = performance.now();
    first = [];
    events = [];
    note(`focus ${(event.target as Element | null)?.tagName ?? '?'}`);
  };
  const onBlur = () => note('blur');
  const onVvResize = () => note(`vvR ${r(vv?.height ?? 0)}`);
  const onVvScroll = () => note(`vvS ${r(vv?.offsetTop ?? 0)}`);
  let lastScroll = -1;
  const onScroll = () => {
    const y = r(window.scrollY);
    if (Math.abs(y - lastScroll) < 8) return;
    lastScroll = y;
    note(`scr ${y}`);
  };
  const onTouch = () => note('touch');
  const onWinResize = () => note(`winR ${r(window.innerHeight)}`);
  // The app's own moves of the page.
  const scrollBy = window.scrollBy;
  window.scrollBy = function (this: Window, ...args: unknown[]) {
    const by = args[0] && typeof args[0] === 'object' ? (args[0] as ScrollToOptions).top : args[1];
    note(`BY ${r(Number(by ?? 0))}`);
    return (scrollBy as (...a: unknown[]) => void).apply(this, args);
  } as typeof window.scrollBy;

  document.addEventListener('focusin', onFocus);
  document.addEventListener('focusout', onBlur);
  vv?.addEventListener('resize', onVvResize);
  vv?.addEventListener('scroll', onVvScroll);
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('touchmove', onTouch, { passive: true });
  window.addEventListener('resize', onWinResize);

  // What is painted just above the keyboard (Eduard, 13 Nov 2026: a white strip there): the page's
  // own things at that point, and anything fixed or sticky that reaches it. Read once a second.
  let under = '';
  let underAt = 0;
  const brief = (el: Element) => {
    const css = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}.${String(el.className).slice(0, 14)} ${css.position.slice(0, 3)} ${css.backgroundColor.replace(/\s/g, '')} ${r(box.top)}>${r(box.bottom)}`;
  };
  const lookUnder = () => {
    const top = seenTop(vv ?? null, window.scrollY);
    const y = top + (vv?.height ?? window.innerHeight) - 20;
    const hit = (document.elementsFromPoint?.(window.innerWidth / 2, y) ?? []).filter((el) => el !== strip).slice(0, 3);
    const pinned = Array.from(document.querySelectorAll<HTMLElement>('body *')).filter((el) => {
      if (el === strip || el === safe) return false;
      const position = getComputedStyle(el).position;
      if (position !== 'fixed' && position !== 'sticky') return false;
      const box = el.getBoundingClientRect();
      return box.height > 0 && box.width > 0 && box.top < y + 20 && box.bottom > y - 40;
    });
    under =
      `at ${r(y)}: ${hit.map(brief).join(' < ') || '-'}\npinned ${pinned.length}: ${pinned.slice(0, 3).map(brief).join(' ; ') || '-'} ` +
      `root ${getComputedStyle(root).backgroundColor.replace(/\s/g, '')} body ${getComputedStyle(document.body).backgroundColor.replace(/\s/g, '')} ` +
      `frames ${document.querySelectorAll('iframe').length} kids ${document.body.children.length}`;
  };

  let frame = 0;
  const draw = () => {
    if (performance.now() - underAt > 1000) {
      underAt = performance.now();
      lookUnder();
    }
    const css = getComputedStyle(root);
    const off = r(vv?.offsetTop ?? 0);
    const field = document.activeElement;
    let about = 'field -';
    if (field instanceof HTMLElement && opensKeyboard(field)) {
      const host = scrollHost(field);
      const band = visibleBand(vv, window.innerHeight, host ? 0 : navTopPx(), window.scrollY);
      const rect = field.getBoundingClientRect();
      const area = fieldArea(field);
      about =
        `field ${r(rect.top)}>${r(rect.bottom)} label ${r(area.top)} band ${r(band.top)}>${r(band.bottom)} ` +
        `need ${placeField(area, rect, band)}${host ? ' host' : ''}`;
    }
    const scroller = document.scrollingElement ?? root;
    strip.style.top = `${off}px`;
    strip.textContent =
      `kb ${root.hasAttribute('data-keyboard') ? 1 : 0} inner ${r(window.innerHeight)}x${r(window.innerWidth)} ` +
      `vv ${r(vv?.height ?? -1)} off ${off} page ${r(vv?.pageTop ?? -1)} sc ${vv ? vv.scale.toFixed(2) : '-'} ` +
      `client ${root.clientHeight} screen ${screen.height}\n` +
      `y ${r(window.scrollY)}/${scroller.scrollHeight - window.innerHeight} room ${css.getPropertyValue('--kb-room').trim() || '-'} ` +
      `vvtop ${css.getPropertyValue('--vv-top').trim() || '-'} nav ${css.getPropertyValue('--nav-top').trim() || '-'}+${css.getPropertyValue('--back-bar').trim() || '0'} ` +
      `bar ${css.getPropertyValue('--nav-bottom').trim() || '-'} safe ${parseFloat(getComputedStyle(safe).borderTopWidth) || 0}/${parseFloat(getComputedStyle(safe).borderBottomWidth) || 0}\n` +
      `${about} hdr ${r(document.querySelector('header')?.getBoundingClientRect().top ?? -1)}\n${first.join(' | ')}${events.length ? ' ... ' : ''}${events.join(' | ')}\n${under}\n${APP_RELEASE.slice(0, 7)} ${navigator.userAgent.match(/OS [\d_]+|Android [\d.]+|Chrome\/[\d]+/)?.[0] ?? ''}`;
    frame = window.requestAnimationFrame(draw);
  };
  draw();

  return () => {
    window.cancelAnimationFrame(frame);
    window.scrollBy = scrollBy;
    document.removeEventListener('focusin', onFocus);
    document.removeEventListener('focusout', onBlur);
    vv?.removeEventListener('resize', onVvResize);
    vv?.removeEventListener('scroll', onVvScroll);
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('touchmove', onTouch);
    window.removeEventListener('resize', onWinResize);
    strip.remove();
    safe.remove();
  };
}
