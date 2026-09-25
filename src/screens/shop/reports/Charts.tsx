import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../../i18n/context';
import { formatCompactAmount, formatMoney, formatMonthShort, formatMonthYear } from '../../../i18n/format';
import { plural } from '../../../i18n/translate';
import type { MonthRevenue, ServiceRow } from '../../../lib/shopReports';
import styles from './reports.module.css';

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

const CHART_HEIGHT = 170;
const TOP = 20; // room for the value above the tallest bar
const BOTTOM = 24; // room for the month names

/**
 * Încasări pe lună (P22): 12 amber bars, the value above each and the month beneath — drawn at the
 * real width of the card, so the text is never stretched. Screen readers get the same figures as a
 * table.
 */
export function MonthlyChart({ months, currentMonth }: { months: MonthRevenue[]; currentMonth: string }) {
  const { t, lang } = useI18n();
  const [ref, width] = useWidth<HTMLDivElement>();
  const max = Math.max(...months.map((m) => m.revenue), 0);
  const slot = width / months.length;
  const barWidth = Math.min(40, slot * 0.64);
  const area = CHART_HEIGHT - TOP - BOTTOM;
  const small = slot < 34;

  return (
    <div ref={ref} className={styles.chart}>
      {width > 0 && (
        <svg width={width} height={CHART_HEIGHT} aria-hidden="true" className={styles.chartSvg}>
          <line x1={0} x2={width} y1={TOP + area + 0.5} y2={TOP + area + 0.5} className={styles.axis} />
          {months.map((m, i) => {
            const cx = slot * i + slot / 2;
            const h = max > 0 ? Math.max(m.revenue > 0 ? 3 : 0, (m.revenue / max) * area) : 0;
            const current = m.month === currentMonth;
            return (
              <g key={m.month}>
                {h > 0 && (
                  <rect x={cx - barWidth / 2} y={TOP + area - h} width={barWidth} height={h} rx={3} className={styles.bar} />
                )}
                {m.revenue > 0 && (
                  <text x={cx} y={TOP + area - h - 5} textAnchor="middle" className={`${styles.barValue} ${small ? styles.tiny : ''}`}>
                    {formatCompactAmount(lang, m.revenue)}
                  </text>
                )}
                <text
                  x={cx}
                  y={CHART_HEIGHT - 7}
                  textAnchor="middle"
                  className={`${styles.barLabel} ${small ? styles.tiny : ''} ${current ? styles.current : ''}`}
                >
                  {formatMonthShort(lang, m.month)}
                </text>
              </g>
            );
          })}
        </svg>
      )}
      <table className="visually-hidden">
        <caption>{t('rep.byMonth')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('rep.col.month')}</th>
            <th scope="col">{t('rep.revenue')}</th>
            <th scope="col">{t('rep.jobs')}</th>
          </tr>
        </thead>
        <tbody>
          {months.map((m) => (
            <tr key={m.month}>
              <th scope="row">{formatMonthYear(lang, `${m.month}-01`)}</th>
              <td>{formatMoney(lang, m.revenue)}</td>
              <td>{m.jobs}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A thin horizontal bar, 0–1 of its track; the figure is always written next to it. */
export function Meter({ share, tone = 'amber' }: { share: number; tone?: 'amber' | 'green' | 'red' | 'blue' }) {
  const pct = Math.max(0, Math.min(1, share)) * 100;
  return (
    <svg width="100%" height={8} className={styles.meter} aria-hidden="true" preserveAspectRatio="none">
      <rect x={0} y={0} width="100%" height={8} rx={4} className={styles.track} />
      {pct > 0 && <rect x={0} y={0} width={`${pct}%`} height={8} rx={4} className={styles[tone]} />}
    </svg>
  );
}

/** Lucrări pe tip de serviciu (P22): most frequent first, count and revenue, the bar by count. */
export function ServiceBars({ rows }: { rows: ServiceRow[] }) {
  const { t, lang } = useI18n();
  const most = Math.max(...rows.map((r) => r.count), 1);
  return (
    <ul className={styles.services}>
      {rows.map((r) => {
        const name = r.service_id === null ? t('rep.other') : ((lang === 'ro' ? r.name_ro : r.name_en) ?? r.service_id);
        return (
          <li key={r.service_id ?? 'other'} className={styles.serviceRow}>
            <div className={styles.serviceTop}>
              <span className={styles.serviceName}>
                {name} <span className={styles.muted}>· {plural(lang, 'unit.jobs', r.count)}</span>
              </span>
              <span className={`mono ${styles.serviceAmount}`}>{formatMoney(lang, r.revenue)}</span>
            </div>
            <Meter share={r.count / most} />
          </li>
        );
      })}
    </ul>
  );
}
