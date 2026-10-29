import type { MouseEvent } from 'react';
import { CAR_PATHS, CAR_VIEW, type DamageMark } from '../../../supabase/functions/_shared/carDiagram.ts';
import { useI18n } from '../../i18n/context';
import styles from './CarDiagram.module.css';

/**
 * The car seen from above (T50), with the damage marks numbered as in the list beside it. With
 * `onAdd`, the drawing is one button: a tap adds a mark where it lands (from the keyboard, in the
 * middle; the list then says what and where). The same paths draw the PDF.
 */
export function CarDiagram({
  marks,
  onAdd,
  label,
}: {
  marks: readonly DamageMark[];
  onAdd?: (x: number, y: number) => void;
  label: string;
}) {
  const { t } = useI18n();
  const drawing = (
    <svg className={styles.svg} viewBox={`-6 -18 ${CAR_VIEW.width + 12} ${CAR_VIEW.height + 36}`} aria-hidden="true">
      <text x={CAR_VIEW.width / 2} y={-6} className={styles.side} textAnchor="middle">
        {t('in.front')}
      </text>
      {CAR_PATHS.wheels.map((d) => (
        <path key={d} d={d} className={styles.wheel} />
      ))}
      <path d={CAR_PATHS.body} className={styles.body} />
      {CAR_PATHS.details.map((d) => (
        <path key={d} d={d} className={styles.detail} />
      ))}
      <text x={CAR_VIEW.width / 2} y={CAR_VIEW.height + 14} className={styles.side} textAnchor="middle">
        {t('in.rear')}
      </text>
      {marks.map((m, i) => (
        <g key={`${i}-${m.x}-${m.y}`} transform={`translate(${m.x * CAR_VIEW.width} ${m.y * CAR_VIEW.height})`}>
          <circle r={11} className={styles.mark} />
          <text className={styles.markText} textAnchor="middle" dy="0.35em">
            {i + 1}
          </text>
        </g>
      ))}
    </svg>
  );

  if (!onAdd) {
    return (
      <div className={styles.frame} role="img" aria-label={label}>
        {drawing}
      </div>
    );
  }

  function add(e: MouseEvent<HTMLButtonElement>) {
    const svg = e.currentTarget.querySelector('svg');
    // A keyboard press has no position: the middle of the car.
    if (!svg || e.detail === 0) {
      onAdd!(0.5, 0.5);
      return;
    }
    const box = svg.getBoundingClientRect();
    const scaleX = (CAR_VIEW.width + 12) / box.width;
    const scaleY = (CAR_VIEW.height + 36) / box.height;
    const x = ((e.clientX - box.left) * scaleX - 6) / CAR_VIEW.width;
    const y = ((e.clientY - box.top) * scaleY - 18) / CAR_VIEW.height;
    onAdd!(Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y)));
  }

  return (
    <button type="button" className={`${styles.frame} ${styles.editable}`} aria-label={label} onClick={add}>
      {drawing}
    </button>
  );
}
