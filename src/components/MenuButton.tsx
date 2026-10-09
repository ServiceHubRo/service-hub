import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { buttonClass, type ButtonVariant } from './buttonClass';
import styles from './MenuButton.module.css';

export type MenuItem =
  | { key: string; label: ReactNode; icon?: ReactNode; href: string; external?: boolean }
  | { key: string; label: ReactNode; icon?: ReactNode; onSelect: () => void };

/**
 * One button that opens a short menu of actions (Eduard, 9 Oct: a pop-up instead of a row of
 * buttons). Arrow keys move between the items, Escape or a tap outside closes it, and the focus
 * returns to the button. The menu floats, so opening it never moves the page.
 */
export function MenuButton({
  label,
  items,
  variant = 'primary',
  block = true,
}: {
  label: ReactNode;
  items: MenuItem[];
  variant?: ButtonVariant;
  block?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
      </button>
      {open && (
        <div ref={menuRef} id={`${id}-menu`} role="menu" className={styles.menu}>
          {items.map((item) =>
            'href' in item ? (
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
                className={styles.item}
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
