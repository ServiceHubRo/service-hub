import { Minus, Plus } from 'lucide-react';
import { useId } from 'react';
import styles from './Stepper.module.css';

export interface StepperProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  decreaseLabel: string;
  increaseLabel: string;
}

/** − value + control. Changing the value never moves focus or scroll position. */
export function Stepper({ label, value, min, max, step = 1, onChange, decreaseLabel, increaseLabel }: StepperProps) {
  const id = useId();
  const set = (next: number) => onChange(Math.min(max, Math.max(min, next)));
  return (
    <div className={styles.row}>
      <span id={id} className={styles.label}>
        {label}
      </span>
      <div className={styles.control} role="group" aria-labelledby={id}>
        <button
          type="button"
          className={styles.btn}
          aria-label={`${decreaseLabel}: ${label}`}
          disabled={value <= min}
          onClick={() => set(value - step)}
        >
          <Minus size={18} aria-hidden="true" />
        </button>
        <output className={styles.value} aria-live="polite">
          {value}
        </output>
        <button
          type="button"
          className={styles.btn}
          aria-label={`${increaseLabel}: ${label}`}
          disabled={value >= max}
          onClick={() => set(value + step)}
        >
          <Plus size={18} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
