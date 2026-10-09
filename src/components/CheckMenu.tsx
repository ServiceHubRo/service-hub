import { ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Checkbox } from './Checkbox';
import fieldStyles from './Field.module.css';
import styles from './CheckMenu.module.css';

export interface CheckMenuProps {
  label: string;
  /** What is chosen, in words ("Marți, Miercuri", "Toate serviciile"). */
  summary: string;
  options: { value: string; label: string }[];
  selected: readonly string[];
  onToggle: (value: string) => void;
  /** A first line that means "all of them" (ticked while `allSelected`). */
  all?: { label: string; selected: boolean; onSelect: () => void };
  error?: string | null;
}

/**
 * A field that opens a short list to tick (Eduard, 9 Oct: a pop-up instead of rows of buttons).
 * The list floats over the page, so opening it never moves anything; a tap outside or Escape
 * closes it (Escape gives the focus back to the field).
 */
export function CheckMenu({ label, summary, options, selected, onToggle, all, error }: CheckMenuProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector('input')?.focus({ preventScroll: true });
    const outside = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  return (
    <div className={fieldStyles.field} ref={wrapRef}>
      <span id={`${id}-label`} className={fieldStyles.label}>
        {label}
      </span>
      <div className={styles.anchor}>
        <button
          ref={buttonRef}
          type="button"
          id={`${id}-button`}
          className={`${fieldStyles.input} ${styles.button}`}
          aria-labelledby={`${id}-label ${id}-button`}
          aria-expanded={open}
          aria-controls={`${id}-panel`}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onClick={() => setOpen((o) => !o)}
        >
          <span className={styles.summary}>{summary}</span>
          <ChevronDown size={18} className={open ? styles.iconOpen : styles.icon} aria-hidden="true" />
        </button>
        {open && (
          <div ref={panelRef} id={`${id}-panel`} role="group" aria-labelledby={`${id}-label`} className={styles.panel}>
            {all && (
              <Checkbox checked={all.selected} onChange={all.onSelect} className={styles.allRow}>
                {all.label}
              </Checkbox>
            )}
            {options.map((o) => (
              <Checkbox key={o.value} checked={selected.includes(o.value)} onChange={() => onToggle(o.value)}>
                {o.label}
              </Checkbox>
            ))}
          </div>
        )}
      </div>
      {error && (
        <span id={`${id}-error`} className={fieldStyles.error} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
