import { Search, X } from 'lucide-react';
import styles from './SearchField.module.css';

export interface SearchFieldProps {
  id: string;
  /** Read by screen readers (the placeholder alone disappears while typing). */
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  /** The ✕ inside the field, shown while it holds text. */
  onClear: () => void;
  clearLabel: string;
}

/** Search box with the magnifier and a clear button (Caută, Istoric). 16 px text: no iOS zoom. */
export function SearchField({ id, label, placeholder, value, onChange, onClear, clearLabel }: SearchFieldProps) {
  return (
    <div className={styles.box}>
      <label htmlFor={id} className="visually-hidden">
        {label}
      </label>
      <Search size={18} className={styles.icon} aria-hidden="true" />
      <input
        id={id}
        type="search"
        className={styles.input}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        enterKeyHint="search"
      />
      {value && (
        <button type="button" className={styles.clear} aria-label={clearLabel} onClick={onClear}>
          <X size={18} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
