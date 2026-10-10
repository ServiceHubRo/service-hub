import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { buttonClass, type ButtonVariant } from './buttonClass';
import { opensUp, visibleArea } from '../lib/menuPlacement';
import styles from './MenuButton.module.css';

export type MenuItem =
  | { key: string; label: ReactNode; icon?: ReactNode; href: string; external?: boolean }
  /** A screen of the app (no page reload). */
  | { key: string; label: ReactNode; icon?: ReactNode; to: string; state?: unknown }
  | { key: string; label: ReactNode; icon?: ReactNode; onSelect: () => void; danger?: boolean };

/**
 * One button that opens a short menu of actions (Eduard, 9 Oct: a pop-up instead of a row of
 * buttons). Arrow keys move between the items, Escape or a tap outside closes it, and the focus
 * returns to the button. The menu floats, so opening it never moves the page; it opens upwards
 * when the room below (above the tab bar) is too short for it (Eduard, 10 Oct: on the last card
 * only the first entry showed).
 */
export function MenuButton({
  label,
  items,
  variant = 'primary',
  block = true,
  narrow = false,
  ariaLabel,
}: {
  label: ReactNode;
  items: MenuItem[];
  variant?: ButtonVariant;
  block?: boolean;
  /** A small button ("Mai multe"): the menu is wider than it and opens towards the left. */
  narrow?: boolean;
  ariaLabel?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Measured before the menu is painted, so it never shows on the wrong side first.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    const button = buttonRef.current;
    if (!open || !menu || !button) return;
    const { top, bottom } = visibleArea();
    const flip = opensUp(button.getBoundingClientRect(), menu.offsetHeight, bottom, top);
    menu.classList.toggle(styles.menuUp ?? '', flip);
    // No room either way (a very short window): the page scrolls just enough to show it.
    if (!flip && menu.getBoundingClientRect().bottom > bottom) menu.scrollIntoView?.({ block: 'nearest' });
  }, [open]);

  const close = (focus: boolean) => {
    setOpen(false);
    if (focus) buttonRef.current?.focus({ preventScroll: true });
  };

  useEffect(() => {
    if (!open) return;
    const entries = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    entries()[0]?.focus({ preventScroll: true });
    const outside = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        buttonRef.current?.focus({ preventScroll: true });
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const list = entries();
      const at = list.indexOf(document.activeElement as HTMLElement);
      const next = e.key === 'ArrowDown' ? (at + 1) % list.length : (at - 1 + list.length) % list.length;
      list[next]?.focus({ preventScroll: true });
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className={buttonClass(variant, block)}
        aria-haspopup="menu"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
      </button>
      {open && (
        <div ref={menuRef} id={`${id}-menu`} role="menu" className={`${styles.menu} ${narrow ? styles.menuNarrow : ''}`}>
          {items.map((item) =>
            'to' in item ? (
              <Link
                key={item.key}
                role="menuitem"
                className={styles.item}
                to={item.to}
                state={item.state}
                onClick={() => close(false)}
              >
                {item.icon}
                {item.label}
              </Link>
            ) : 'href' in item ? (
              <a
                key={item.key}
                role="menuitem"
                className={styles.item}
                href={item.href}
                {...(item.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                onClick={() => close(false)}
              >
                {item.icon}
                {item.label}
              </a>
            ) : (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                className={`${styles.item} ${item.danger ? styles.itemDanger : ''}`}
                onClick={() => {
                  item.onSelect();
                  close(true);
                }}
              >
                {item.icon}
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
