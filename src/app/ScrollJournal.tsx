import { useEffect, useState } from 'react';
import { IS_TEST_BUILD } from '../lib/env';
import { storage } from '../lib/storage';

const KEY = 'sh_scroll_journal';

/**
 * TEMPORARY (Eduard, 6 Nov 2026: Safari on the iPhone throws the content to the top after a
 * screenshot, and it cannot be reproduced elsewhere). Test builds only, turned on with `?jurnal=1`
 * (off with `?jurnal=0`): a small panel lists what the browser did — the page hidden or shown,
 * size changes, focus, and every jump of the content of more than 200 px, with what it jumped from
 * and to. Not translated on purpose: a diagnostic for the developer, removed once the cause is known.
 */
export function ScrollJournal() {
  const [on] = useState(() => {
    if (!IS_TEST_BUILD) return false;
    const param = new URLSearchParams(window.location.search).get('jurnal');
    if (param === '1') storage.set(KEY, '1');
    if (param === '0') storage.remove(KEY);
    return storage.get(KEY) === '1';
  });
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    if (!on) return;
    const t0 = performance.now();
    const stamp = () => `${((performance.now() - t0) / 1000).toFixed(2)}s`;
    const add = (text: string) => setLines((prev) => [...prev.slice(-19), `${stamp()} ${text}`]);
    const el = (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
    let last = el?.scrollTop ?? 0;
    let touchedAt = -Infinity;
    const content = () => document.querySelector('#continut > div')?.firstElementChild ?? null;
    let child = content();

    const size = () => `${window.innerWidth}×${window.innerHeight} vv ${Math.round(window.visualViewport?.height ?? 0)}`;
    const onScroll = () => {
      if (!el) return;
      const top = Math.round(el.scrollTop);
      if (Math.abs(top - last) > 200) {
        const touched = performance.now() - touchedAt < 1000 ? 'touch' : 'NO touch';
        add(`JUMP ${Math.round(last)}→${top} (${touched}) h ${el.scrollHeight}/${el.clientHeight} vis ${document.visibilityState} main ${getComputedStyle(document.getElementById('continut') ?? el).overflowY}`);
      }
      last = el.scrollTop;
      const now = content();
      if (now !== child) {
        add('content replaced');
        child = now;
      }
    };
    const touched = () => {
      touchedAt = performance.now();
    };
    const handlers: [EventTarget, string, () => void][] = [
      [document, 'visibilitychange', () => add(`visibility ${document.visibilityState} top ${Math.round(el?.scrollTop ?? 0)}`)],
      [window, 'pagehide', () => add('pagehide')],
      [window, 'pageshow', () => add('pageshow')],
      [window, 'blur', () => add(`blur top ${Math.round(el?.scrollTop ?? 0)}`)],
      [window, 'focus', () => add(`focus top ${Math.round(el?.scrollTop ?? 0)}`)],
      [window, 'resize', () => add(`resize ${size()} top ${Math.round(el?.scrollTop ?? 0)}`)],
      [window, 'beforeprint', () => add('beforeprint')],
      [window, 'afterprint', () => add('afterprint')],
      [document, 'focusin', () => add(`focusin ${(document.activeElement as HTMLElement | null)?.tagName ?? ''}`)],
    ];
    // Safari may lay the page out for print to make the „Full Page” screenshot (a PDF).
    const print = window.matchMedia('print');
    const onPrintMedia = () => add(`media print ${print.matches ? 'ON' : 'off'} top ${Math.round(el?.scrollTop ?? 0)} main ${getComputedStyle(document.getElementById('continut') ?? el).overflowY}`);
    print.addEventListener('change', onPrintMedia);
    if (window.visualViewport) handlers.push([window.visualViewport, 'resize', () => add(`vv resize ${size()}`)]);
    for (const [target, type, fn] of handlers) target.addEventListener(type, fn);
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('touchstart', touched, { passive: true, capture: true });
    add(`on ${size()}`);

    // The page getting shorter for a moment (a screen replaced by its skeleton, an empty state):
    // the browser then cuts the scroll to what is left.
    const main = document.getElementById('continut');
    let height = main?.offsetHeight ?? 0;
    const shrink = main && typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
          const h = main.offsetHeight;
          if (h < height - 200) {
            const text = (main.innerText || '').replace(/\s+/g, ' ').slice(0, 40);
            add(`SHRINK ${height}→${h} top ${Math.round(el.scrollTop)} «${text}»`);
          }
          height = h;
        })
      : null;
    if (main) shrink?.observe(main);

    // What the app asked the server just before (after the first seconds).
    const realFetch = window.fetch;
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const name = url.match(/rest\/v1\/(rpc\/)?([a-z_]+)/)?.[2] ?? (url.includes('/auth/') ? `auth ${url.split('/auth/v1/')[1]?.split('?')[0]}` : null);
      const result = realFetch(input, init);
      if (name && performance.now() - t0 > 3000) {
        result.then(
          (r) => add(`req ${name} ${r.status}`),
          () => add(`req ${name} failed`),
        );
      }
      return result;
    };

    // Anything in the app that scrolls or focuses on its own.
    const proto = { into: Element.prototype.scrollIntoView, to: Element.prototype.scrollTo, focus: HTMLElement.prototype.focus, win: window.scrollTo };
    const label = (e: Element) => `${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ''}.${String(e.className).split(' ')[0]?.slice(0, 24) ?? ''}`;
    Element.prototype.scrollIntoView = function (this: Element, ...args: Parameters<Element['scrollIntoView']>) {
      add(`call scrollIntoView ${label(this)}`);
      return proto.into.apply(this, args);
    };
    HTMLElement.prototype.focus = function (this: HTMLElement, ...args: Parameters<HTMLElement['focus']>) {
      add(`call focus ${label(this)}`);
      return proto.focus.apply(this, args);
    };
    window.scrollTo = ((...args: unknown[]) => {
      add(`call window.scrollTo ${JSON.stringify(args).slice(0, 30)}`);
      return (proto.win as (...a: unknown[]) => void).apply(window, args);
    }) as typeof window.scrollTo;
    Element.prototype.scrollTo = function (this: Element, ...args: unknown[]) {
      add(`call scrollTo ${label(this)} ${JSON.stringify(args).slice(0, 30)}`);
      return (proto.to as (...a: unknown[]) => void).apply(this, args);
    } as typeof Element.prototype.scrollTo;
    // A jump that fires no scroll event (seen only by looking): checked a few times a second.
    const timer = window.setInterval(() => {
      if (el && Math.abs(el.scrollTop - last) > 200) onScroll();
    }, 250);
    return () => {
      for (const [target, type, fn] of handlers) target.removeEventListener(type, fn);
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('touchstart', touched, { capture: true });
      window.clearInterval(timer);
      print.removeEventListener('change', onPrintMedia);
      shrink?.disconnect();
      window.fetch = realFetch;
      Element.prototype.scrollIntoView = proto.into;
      Element.prototype.scrollTo = proto.to;
      HTMLElement.prototype.focus = proto.focus;
      window.scrollTo = proto.win;
    };
  }, [on]);

  if (!on) return null;
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        top: 'calc(env(safe-area-inset-top) + 64px)',
        left: 8,
        right: 8,
        zIndex: 9999,
        background: 'rgba(0,0,0,0.82)',
        color: '#9fe870',
        font: '11px/1.35 ui-monospace, Menlo, monospace',
        padding: '6px 8px',
        borderRadius: 8,
        pointerEvents: 'none',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
      }}
    >
      {lines.join('\n') || 'jurnal'}
    </div>
  );
}
