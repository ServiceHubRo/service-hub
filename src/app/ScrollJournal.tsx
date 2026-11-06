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
    const add = (text: string) => setLines((prev) => [...prev.slice(-13), `${stamp()} ${text}`]);
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
