import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useI18n } from '../../i18n/context';
import { formatCompactAmount, formatMoney, formatMonthShort, formatMonthYear } from '../../i18n/format';
import type { MonthTotal } from '../../lib/fleet';
import { motionOn } from '../../lib/motion';
import { Meter } from '../shop/reports/Charts';
import styles from './fleet.module.css';

/** The width of an element, followed as it changes (rotation, sidebar, window). */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

const HEIGHT = 180;
const TOP = 22;
const BOTTOM = 24;

/**
 * Costs per month: amber bars at the card's real width, the value above each, the month beneath. A
 * budget, when the company set one, is a dashed line and a month above it turns red (with the word
 * in the hidden table, never color alone). Screen readers get the same figures as a table.
 */
export function MonthBars({ months, currentMonth, budget, caption }: { months: MonthTotal[]; currentMonth: string; budget?: number | null; caption: string }) {
  const { t, lang } = useI18n();
  const [ref, width] = useWidth<HTMLDivElement>();
  const max = Math.max(...months.map((m) => m.total), budget ?? 0, 0);
  const slot = months.length > 0 ? width / months.length : 0;
  const barWidth = Math.min(40, slot * 0.62);
  const area = HEIGHT - TOP - BOTTOM;
  const small = slot < 34;
  const y = (v: number) => TOP + area - (max > 0 ? (v / max) * area : 0);
  const grow = motionOn('countUp');

  return (
    <div ref={ref} className={grow ? `${styles.chart} ${styles.grow}` : styles.chart}>
      {width > 0 && (
        <svg width={width} height={HEIGHT} aria-hidden="true" className={styles.chartSvg}>
          <line x1={0} x2={width} y1={TOP + area + 0.5} y2={TOP + area + 0.5} className={styles.axis} />
          {months.map((m, i) => {
            const cx = slot * i + slot / 2;
            const h = max > 0 ? Math.max(m.total > 0 ? 3 : 0, (m.total / max) * area) : 0;
            const over = budget != null && m.total > budget;
            return (
              <g key={m.month} style={{ '--i': i } as CSSProperties}>
                {h > 0 && <rect x={cx - barWidth / 2} y={TOP + area - h} width={barWidth} height={h} rx={3} className={over ? styles.barOver : styles.bar} />}
                {m.total > 0 && (
                  <text x={cx} y={TOP + area - h - 5} textAnchor="middle" className={`${styles.barValue} ${small ? styles.tiny : ''}`}>
                    {formatCompactAmount(lang, m.total)}
                  </text>
                )}
                <text x={cx} y={HEIGHT - 7} textAnchor="middle" className={`${styles.barLabel} ${small ? styles.tiny : ''} ${m.month === currentMonth ? styles.current : ''}`}>
                  {formatMonthShort(lang, m.month)}
                </text>
              </g>
            );
          })}
          {budget != null && budget > 0 && <line x1={0} x2={width} y1={y(budget) + 0.5} y2={y(budget) + 0.5} className={styles.budgetLine} />}
        </svg>
      )}
      <table className="visually-hidden">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{t('fleet.col.month')}</th>
            <th scope="col">{t('fleet.col.amount')}</th>
            {budget != null && <th scope="col">{t('fleet.budget.title')}</th>}
          </tr>
        </thead>
        <tbody>
          {months.map((m) => (
            <tr key={m.month}>
              <th scope="row">{formatMonthYear(lang, `${m.month}-01`)}</th>
              <td>{formatMoney(lang, m.total)}</td>
              {budget != null && <td>{m.total > budget ? t('fleet.budget.overShort') : t('fleet.budget.withinShort')}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface ShareRow {
  key: string;
  label: string;
  value: number;
  /** A second line under the label (count of jobs, a reason). */
  hint?: string;
  tone?: 'amber' | 'green' | 'red' | 'blue';
}

/** Largest first, the amount written next to each bar; the bar is the share of the largest. */
export function ShareBars({ rows, format, onPick }: { rows: ShareRow[]; format?: (n: number) => string; onPick?: (key: string) => void }) {
  const { lang } = useI18n();
  const fmt = format ?? ((n: number) => formatMoney(lang, n));
  const most = Math.max(...rows.map((r) => r.value), 0);
  return (
    <ul className={styles.shares}>
      {rows.map((r) => {
        const top = (
          <span className={styles.shareTop}>
            <span className={styles.shareName}>
              {r.label}
              {r.hint && <span className={styles.muted}> · {r.hint}</span>}
            </span>
            <span className={`mono ${styles.shareAmount}`}>{fmt(r.value)}</span>
          </span>
        );
        return (
          <li key={r.key} className={styles.shareRow}>
            {onPick ? (
              <button type="button" className={styles.shareButton} onClick={() => onPick(r.key)}>
                {top}
                <Meter share={most > 0 ? r.value / most : 0} tone={r.tone} />
              </button>
            ) : (
              <>
                {top}
                <Meter share={most > 0 ? r.value / most : 0} tone={r.tone} />
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}
