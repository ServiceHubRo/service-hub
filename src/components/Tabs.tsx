import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import styles from './Tabs.module.css';

export interface TabItem<K extends string> {
  key: K;
  label: string;
  /** Shown after the label: „Active (3)”. */
  count?: number;
}

const tabId = (base: string, key: string) => `${base}-tab-${key}`;
const panelId = (base: string) => `${base}-panel`;

/**
 * The views of one screen as tabs under its title (page templates, Eduard 14 Nov 2026: what is
 * active apart from what has ended). A real tab list: the arrow keys, Home and End move between
 * the tabs and choose at once; Tab leaves for the content. The screen keeps the chosen tab in its
 * address, so going back finds it.
 */
export function Tabs<K extends string>({
  id,
  label,
  items,
  value,
  onChange,
}: {
  /** Ties the tabs to their TabPanel. */
  id: string;
  /** What the tabs choose between, for screen readers. */
  label: string;
  items: TabItem<K>[];
  value: K;
  onChange: (key: K) => void;
}) {
  const refs = useRef<Partial<Record<K, HTMLButtonElement | null>>>({});

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = items.length - 1;
    const to =
      e.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
      : e.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
      : e.key === 'Home' ? 0
      : e.key === 'End' ? last
      : null;
    if (to === null) return;
    e.preventDefault();
    const next = items[to]!;
    onChange(next.key);
    refs.current[next.key]?.focus();
  }

  return (
    <div className={styles.tabs} role="tablist" aria-label={label}>
      {items.map((item, i) => {
        const on = item.key === value;
        return (
          <button
            key={item.key}
            ref={(el) => {
              refs.current[item.key] = el;
            }}
            type="button"
            role="tab"
            id={tabId(id, item.key)}
            aria-selected={on}
            aria-controls={panelId(id)}
            tabIndex={on ? 0 : -1}
            className={`${styles.tab} ${on ? styles.on : ''}`}
            onClick={() => onChange(item.key)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {item.label}
            {item.count !== undefined && (
              <>
                {' '}
                <span className={`mono ${styles.count}`}>{item.count}</span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** What the chosen tab shows. */
export function TabPanel<K extends string>({ id, value, children }: { id: string; value: K; children: ReactNode }) {
  return (
    <div role="tabpanel" id={panelId(id)} aria-labelledby={tabId(id, value)} className={styles.panel}>
      {children}
    </div>
  );
}
