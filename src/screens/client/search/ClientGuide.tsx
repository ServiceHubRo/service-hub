import { ChevronRight, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ActionButton } from '../../../components/ActionButton';
import { Card } from '../../../components/Card';
import { GuideMark } from '../../../components/GuideMark';
import styles from '../../../components/Guide.module.css';
import { enablePush } from '../../../data/push';
import { rpcErrorMessage } from '../../../data/rpc';
import { useI18n } from '../../../i18n/context';
import { NEW_CAR_PATH } from '../paths';
import type { ClientGuideState } from './useClientGuide';

/** The card itself, shown at the top of Caută while useClientGuide says so. */
export function ClientGuide({ guide }: { guide: ClientGuideState }) {
  const { t, lang } = useI18n();
  const done = guide.steps.filter((s) => s.done).length;
  const total = guide.steps.length;
  const next = guide.steps.find((s) => !s.done)?.key;
  const progress = t('guide.progress', { done, total });

  return (
    <Card highlight data-tour="guide">
      <div className={styles.head}>
        <div className={styles.headText}>
          <h2 className={styles.setupTitle}>{t('guide.title')}</h2>
          <span className={`mono ${styles.progressText}`}>{progress}</span>
        </div>
        <button type="button" className={styles.hide} aria-label={t('guide.hide')} onClick={guide.hide}>
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <div
        className={styles.progress}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-valuetext={progress}
        aria-label={t('guide.title')}
      >
        <span style={{ width: `${(done / total) * 100}%` }} />
      </div>
      <ol className={styles.steps}>
        {guide.steps.map((s, i) => {
          const mark = <GuideMark n={i + 1} done={s.done} current={s.key === next} />;
          const label = (
            <span className={styles.stepText}>
              <span className={s.done ? styles.stepLabelDone : undefined}>{t(`guide.${s.key}`)}</span>
              <span className="visually-hidden"> — {t(s.done ? 'dash.setup.done' : 'dash.setup.todo')}</span>
              {s.key === 'booking' && !s.done && <span className={styles.stepNote}>{t('guide.bookingNote')}</span>}
            </span>
          );
          return (
            <li key={s.key}>
              {s.key === 'car' && !s.done ? (
                <Link to={NEW_CAR_PATH} className={styles.step}>
                  {mark}
                  {label}
                  <ChevronRight size={18} className={styles.chevron} aria-hidden="true" />
                </Link>
              ) : (
                <div className={styles.step}>
                  {mark}
                  {label}
                  {s.key === 'push' && !s.done && (
                    <span className={styles.stepAction}>
                      <ActionButton
                        variant="secondary"
                        block={false}
                        onAction={() => enablePush()}
                        errorMessage={(e) => rpcErrorMessage(lang, e)}
                      >
                        {t('push.enable')}
                      </ActionButton>
                    </span>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
