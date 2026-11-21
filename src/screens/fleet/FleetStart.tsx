import { ChevronRight, X } from 'lucide-react';
import { useState } from 'react';
import { Card } from '../../components/Card';
import { GuideMark } from '../../components/GuideMark';
import styles from '../../components/Guide.module.css';
import { useI18n } from '../../i18n/context';
import type { StartStep } from '../../lib/fleet';
import { storage } from '../../lib/storage';
import { useFleet } from './fleetContext';

/** Hidden by the member for this company, on this device (a convenience: nothing else depends on it). */
const hiddenKey = (companyId: string) => `sh_fleet_start_off_${companyId}`;

/**
 * „Primii pași” of the fleet space, at the top of Panou: the steps the member can do, each a row that
 * opens the page where it is done, ticked by the data itself. Rows, not buttons: the screen's one
 * filled button stays in Vehicule. While the fleet has no vehicle it is the whole of Panou (and cannot
 * be hidden); after that it stays only while a step is left and can be hidden.
 */
export function FleetStart({ steps, canHide }: { steps: StartStep[]; canHide: boolean }) {
  const { t } = useI18n();
  const { data, go } = useFleet();
  const key = hiddenKey(data.company.id);
  const [hidden, setHidden] = useState(() => storage.get(key) === '1');
  if (steps.length === 0 || (canHide && hidden)) return null;
  const done = steps.filter((s) => s.done).length;
  const total = steps.length;
  const next = steps.find((s) => !s.done)?.key;
  const progress = t('guide.progress', { done, total });

  return (
    <Card highlight>
      <div className={styles.head}>
        <div className={styles.headText}>
          <h2 className={styles.setupTitle}>{t('guide.title')}</h2>
          <span className={`mono ${styles.progressText}`}>{progress}</span>
        </div>
        {canHide && (
          <button
            type="button"
            className={styles.hide}
            aria-label={t('guide.hide')}
            onClick={() => {
              storage.set(key, '1');
              setHidden(true);
            }}
          >
            <X size={18} aria-hidden="true" />
          </button>
        )}
      </div>
      <div className={styles.progress} role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-valuetext={progress} aria-label={t('guide.title')}>
        <span style={{ width: `${(done / total) * 100}%` }} />
      </div>
      <ol className={styles.steps}>
        {steps.map((s, i) => {
          const body = (
            <>
              <GuideMark n={i + 1} done={s.done} current={s.key === next} />
              <span className={styles.stepText}>
                <span className={s.done ? styles.stepLabelDone : undefined}>{t(`fleet.start.${s.key}`)}</span>
                <span className="visually-hidden"> — {t(s.done ? 'dash.setup.done' : 'dash.setup.todo')}</span>
              </span>
            </>
          );
          return (
            <li key={s.key}>
              {s.done ? (
                <div className={styles.step}>{body}</div>
              ) : (
                <button type="button" className={styles.step} onClick={() => go(s.link)}>
                  {body}
                  <ChevronRight size={18} className={styles.chevron} aria-hidden="true" />
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
