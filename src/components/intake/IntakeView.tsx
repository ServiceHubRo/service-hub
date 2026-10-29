import { useCallback } from 'react';
import { damageKindText, fuelText } from '../../../supabase/functions/_shared/jobDoc.ts';
import { intakePhotoUrls, type VehicleIntake } from '../../data/jobDocs';
import { useI18n } from '../../i18n/context';
import { formatKm } from '../../i18n/format';
import { momentText } from '../../lib/moment';
import { useLoad } from '../../lib/useLoad';
import { CarDiagram } from './CarDiagram';
import styles from './Intake.module.css';

/**
 * The intake sheet as written (T50), read-only: odometer, fuel, the damage on the drawing and in a
 * numbered list, photos, personal items, notes and the client's options. Shown to the client
 * before confirming, and to the shop once the client confirmed it.
 */
export function IntakeView({ intake }: { intake: VehicleIntake }) {
  const { t, lang } = useI18n();
  const yesNo = (v: boolean | null) => (v === null ? t('in.notSaid') : v ? t('common.yes') : t('common.no'));
  const loadPhotos = useCallback(() => intakePhotoUrls(intake.photos), [intake.photos]);
  const { state: photos } = useLoad(loadPhotos);

  return (
    <div className={styles.view}>
      <dl className={styles.facts}>
        <div>
          <dt>{t('in.received')}</dt>
          <dd>{momentText(lang, intake.created_at)}</dd>
        </div>
        <div>
          <dt>{t('in.odometer')}</dt>
          <dd className="mono">{intake.odometer != null ? formatKm(lang, intake.odometer) : t('in.notSaid')}</dd>
        </div>
        <div>
          <dt>{t('in.fuel')}</dt>
          <dd>{intake.fuel != null ? fuelText(lang, intake.fuel) : t('in.notSaid')}</dd>
        </div>
      </dl>

      <section className={styles.damage} aria-labelledby="in-damage">
        <h2 id="in-damage" className={styles.heading}>
          {t('in.damage')}
        </h2>
        <div className={styles.damageBody}>
          <CarDiagram marks={intake.damages} label={t('in.diagramRead', { n: intake.damages.length })} />
          {intake.damages.length === 0 ? (
            <p className={styles.muted}>{t('in.noDamage')}</p>
          ) : (
            <ol className={styles.markList}>
              {intake.damages.map((m, i) => (
                <li key={`${i}-${m.x}-${m.y}`}>
                  <span className={styles.markNo}>{i + 1}</span>
                  <span>
                    {damageKindText(lang, m.kind)}
                    {m.note ? ` — ${m.note}` : ''}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>

      {intake.photos.length > 0 && (
        <section aria-labelledby="in-photos">
          <h2 id="in-photos" className={styles.heading}>
            {t('in.photos')}
          </h2>
          {photos.status === 'ready' ? (
            <ul className={styles.photos}>
              {intake.photos.map((p, i) =>
                photos.data[p] ? (
                  <li key={p}>
                    <a href={photos.data[p]} target="_blank" rel="noopener noreferrer" aria-label={t('in.photoOpen', { n: i + 1 })}>
                      <img src={photos.data[p]} alt="" loading="lazy" />
                    </a>
                  </li>
                ) : null,
              )}
            </ul>
          ) : photos.status === 'error' ? (
            <p className={styles.muted}>{t('in.photosError')}</p>
          ) : (
            <p className={styles.muted}>{t('in.photosLoading')}</p>
          )}
        </section>
      )}

      {intake.personal_items && (
        <p>
          <span className={styles.label}>{t('in.personal')}: </span>
          {intake.personal_items}
        </p>
      )}
      {intake.notes && (
        <p>
          <span className={styles.label}>{t('in.notes')}: </span>
          {intake.notes}
        </p>
      )}
      <dl className={styles.options}>
        <div>
          <dt>{t('in.keepParts')}</dt>
          <dd>{yesNo(intake.keep_parts)}</dd>
        </div>
        <div>
          <dt>{t('in.roadTest')}</dt>
          <dd>{yesNo(intake.road_test)}</dd>
        </div>
      </dl>
    </div>
  );
}
