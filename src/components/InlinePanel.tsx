import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Card } from './Card';
import styles from './InlinePanel.module.css';

/**
 * The element that last had the focus, even if it is gone since: a card that hides its buttons while
 * a panel is open removes the button that opened it before the panel can look at it.
 */
let lastFocused: HTMLElement | null = null;
if (typeof document !== 'undefined') {
  document.addEventListener('focusin', (e) => {
    if (e.target instanceof HTMLElement) lastFocused = e.target;
  });
}

/**
 * A panel that opens inside a card instead of a dialog (ARCHITECTURE §17): cancelling, a quote
 * refusal, the review form, the shop's actions. Its title takes the focus when it opens, so
 * keyboard and screen-reader users land in it.
 *
 * FUN-03 (audit 13 Nov 2026): Escape inside the panel does what its „Renunță” does (`onClose`), and
 * when the panel goes away the focus returns to the button that opened it, instead of the page.
 */
export function InlinePanel({ title, children, onClose }: { title: string; children: ReactNode; onClose?: () => void }) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    // The element that had the focus when the panel opened: the button that opened it.
    const active = document.activeElement;
    const opener = active instanceof HTMLElement && active !== document.body ? active : lastFocused;
    const panel = titleRef.current?.parentElement ?? null;
    const host = panel?.parentElement ?? null;
    const name = (el: Element) => `${el.tagName}|${el.getAttribute('aria-label') ?? ''}|${(el.textContent ?? '').trim()}`;
    const openerName = opener ? name(opener) : null;
    titleRef.current?.focus({ preventScroll: false });
    return () => {
      const active = document.activeElement;
      const lost = !active || active === document.body || !active.isConnected || (panel?.contains(active) ?? false);
      if (!lost || !opener) return;
      // A card that hides its buttons while the panel is open draws them again: the same button, new.
      const target = opener.isConnected
        ? opener
        : host?.isConnected
          ? Array.from(host.querySelectorAll<HTMLElement>(opener.tagName)).find((el) => name(el) === openerName)
          : undefined;
      target?.focus({ preventScroll: true });
    };
  }, []);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape' || !onClose || e.defaultPrevented) return;
    // A menu or a list open inside the panel closes first (its own Escape).
    if ((e.target as Element).closest?.('[role="menu"], [role="listbox"]') || e.currentTarget.querySelector('[aria-expanded="true"]')) return;
    e.preventDefault();
    e.stopPropagation(); // a panel inside a panel: only the inner one closes
    onClose();
  };
  return (
    <Card inset className={styles.panel} onKeyDown={onClose ? onKeyDown : undefined}>
      <h3 ref={titleRef} tabIndex={-1} className={styles.title}>
        {title}
      </h3>
      {children}
    </Card>
  );
}
