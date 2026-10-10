import { SlidersHorizontal, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '../i18n/context';
import { Button } from './Button';
import { SelectField } from './SelectField';
import styles from './Filters.module.css';

/**
 * Filters behind one button (Eduard, 4 Oct: rows of chips were too many buttons; 10 Oct: dropdowns
 * and switches, no pills). "Filtre" opens a panel — a sheet from the bottom on phones, centered on
 * wider screens — and the filters in use show under it as one quiet line, with "Șterge filtrele".
 * Caută builds its own panel from these pieces; the lists with one-of-several filters use
 * <ChoiceFilters>.
 */

/** The "Filtre" button, with how many filters are on. */
export function FiltersButton({ count, onClick }: { count: number; onClick: () => void }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      className={`${styles.filtersButton} ${count > 0 ? styles.filtersButtonOn : ''}`}
      onClick={onClick}
      aria-haspopup="dialog"
    >
      <SlidersHorizontal size={16} aria-hidden="true" />
      {t('filters.title')}
      {count > 0 && <span className={styles.badge}>{count}</span>}
    </button>
  );
}

export interface ActiveFilter {
  key: string;
  label: string;
}

/** The filters in use, in one line ("Finalizate · Luna aceasta"), and "Șterge filtrele". Nothing when none is on. */
export function ActiveFilters({ items, onClearAll }: { items: readonly ActiveFilter[]; onClearAll?: () => void }) {
  const { t } = useI18n();
  if (items.length === 0) return null;
  return (
    <div className={styles.active}>
      <p className={styles.activeText}>
        <span className="visually-hidden">{t('filters.active')}: </span>
        {items.map((f) => f.label).join(' · ')}
      </p>
      {onClearAll && (
        <button type="button" className={styles.clearAll} onClick={onClearAll}>
          {t('filters.clear')}
        </button>
      )}
    </div>
  );
}

/** The panel: a native modal dialog (focus kept inside, Esc closes), closed also by a tap outside. */
export function FilterSheet({
  open,
  onClose,
  onClear,
  clearDisabled,
  doneLabel,
  children,
}: {
  open: boolean;
  onClose: () => void;
  onClear: () => void;
  clearDisabled: boolean;
  /** "Arată 12 service-uri"; "Gata" by default. */
  doneLabel?: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) d.showModal?.();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className={styles.sheet}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.sheetHead}>
        <h2 id={titleId} className={styles.sheetTitle}>
          {t('filters.title')}
        </h2>
        <button type="button" className={styles.sheetClose} onClick={onClose} aria-label={t('filters.close')}>
          <X size={20} aria-hidden="true" />
        </button>
      </div>
      <div className={styles.sheetBody}>{children}</div>
      <div className={styles.sheetFoot}>
        <Button variant="ghost" onClick={onClear} disabled={clearDisabled}>
          {t('filters.clear')}
        </Button>
        <Button variant="primary" onClick={onClose}>
          {doneLabel ?? t('filters.done')}
        </Button>
      </div>
    </dialog>
  );
}

/** One heading and its controls inside the panel (dropdowns, switches). */
export function FilterGroup({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className={styles.group} aria-labelledby={id}>
      <h3 id={id} className={styles.groupTitle}>
        {title}
      </h3>
      <div className={styles.groupBody}>{children}</div>
    </section>
  );
}

export interface ChoiceGroup {
  key: string;
  title: string;
  options: readonly { value: string; label: string }[];
  value: string;
  /** The choice that means "no filter" ("Toate"): not counted and not listed as on. */
  defaultValue: string;
  onChange: (value: string) => void;
}

/**
 * Lists whose filters are each one choice of several (Istoric: status and period; the admin lists:
 * the state). Choices apply at once; the list stays in sight behind the panel.
 */
export function ChoiceFilters({
  groups,
  onClearAll,
  doneLabel,
  end,
}: {
  groups: readonly ChoiceGroup[];
  /** Resets every group at once (a screen keeping filters in the address changes it once). */
  onClearAll: () => void;
  doneLabel?: string;
  /** Next to the button (e.g. Descarcă, Tipărește). */
  end?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const on = groups.filter((g) => g.value !== g.defaultValue);
  const clearAll = onClearAll;
  return (
    <>
      <div className={styles.bar}>
        <FiltersButton count={on.length} onClick={() => setOpen(true)} />
        {end}
      </div>
      <ActiveFilters
        items={on.map((g) => ({ key: g.key, label: g.options.find((o) => o.value === g.value)?.label ?? g.value }))}
        onClearAll={clearAll}
      />
      <FilterSheet
        open={open}
        onClose={() => setOpen(false)}
        onClear={clearAll}
        clearDisabled={on.length === 0}
        doneLabel={doneLabel}
      >
        {groups.map((g) => (
          <SelectField
            key={g.key}
            label={g.title}
            value={g.value}
            options={[...g.options]}
            onChange={(e) => g.onChange(e.target.value)}
          />
        ))}
      </FilterSheet>
    </>
  );
}
