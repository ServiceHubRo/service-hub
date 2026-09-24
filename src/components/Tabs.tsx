import styles from './Tabs.module.css';

export interface TabItem<K extends string> {
  key: K;
  label: string;
  count?: number;
}

export interface TabsProps<K extends string> {
  items: TabItem<K>[];
  value: K;
  onChange: (key: K) => void;
  label: string;
  /** One dark container with the active tab in amber (sign-in screen). */
  segmented?: boolean;
}

export function Tabs<K extends string>({ items, value, onChange, label, segmented }: TabsProps<K>) {
  return (
    <div className={`${styles.tabs} ${segmented ? styles.segmented : ''}`} role="tablist" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="tab"
          aria-selected={item.key === value}
          className={`${styles.tab} ${item.key === value ? styles.on : ''}`}
          onClick={() => onChange(item.key)}
        >
          {item.label}
          {item.count !== undefined && <span className={styles.count}>{item.count}</span>}
        </button>
      ))}
    </div>
  );
}
