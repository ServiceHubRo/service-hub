import { Bell, Car as CarIcon, Pencil, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { buttonClass } from '../../../components/buttonClass';
import { Card } from '../../../components/Card';
import { EmptyState } from '../../../components/EmptyState';
import { LoadError } from '../../../components/LoadError';
import { SkeletonList } from '../../../components/Skeleton';
import { fetchCars, type Car } from '../../../data/garage';
import { useI18n } from '../../../i18n/context';
import { daysFromToday, formatDayMonth } from '../../../i18n/format';
import type { MessageKey } from '../../../i18n/ro';
import { plural } from '../../../i18n/translate';
import { CAR_DOCS, urgencyOf, type CarDoc } from '../../../lib/expiry';
import { useLoad } from '../../../lib/useLoad';
import { carPath, NEW_CAR_PATH } from '../paths';
import styles from './garage.module.css';

/**
 * Garaj (FR §3.4, P7): the client's cars with their ITP / RCA / vignette dates — muted when far,
 * amber within 30 days, red on or after the day. Only clients have a garage.
 */
export function GarageScreen() {
  const { t, lang } = useI18n();
  const { state, reload } = useLoad(fetchCars);

  return (
    <div className={styles.page}>
      <div>
        <h1>{t('nav.client.garage')}</h1>
        {state.status === 'ready' && state.data.length > 0 && (
          <p className={styles.sub}>{plural(lang, 'unit.savedCars', state.data.length)}</p>
        )}
      </div>
      {state.status === 'loading' && <SkeletonList />}
      {state.status === 'error' && <LoadError message={t('garage.loadError')} onRetry={reload} />}
      {state.status === 'ready' &&
        (state.data.length === 0 ? (
          <EmptyState
            icon={CarIcon}
            title={t('garage.empty')}
            body={t('garage.emptyBody')}
            action={
              <Link to={NEW_CAR_PATH} className={buttonClass('primary')}>
                <Plus size={18} aria-hidden="true" />
                {t('garage.add')}
              </Link>
            }
          />
        ) : (
          <>
            <ul className={styles.list}>
              {state.data.map((car) => (
                <li key={car.id}>
                  <CarCard car={car} />
                </li>
              ))}
            </ul>
            <Link to={NEW_CAR_PATH} className={buttonClass('primary', true)}>
              <Plus size={18} aria-hidden="true" />
              {t('garage.add')}
            </Link>
          </>
        ))}
    </div>
  );
}

function CarCard({ car }: { car: Car }) {
  const { t } = useI18n();
  const name = `${car.make} ${car.model}`;
  const anyDate = CAR_DOCS.some(({ column }) => car[column]);
  return (
    <Card>
      <div className={styles.head}>
        <span className={styles.carTile} aria-hidden="true">
          <CarIcon size={19} />
        </span>
        <div className={styles.carText}>
          <p className={styles.carName}>
            {name} {car.year && <span className={styles.year}>{car.year}</span>}
          </p>
          {car.plate && <p className={`mono ${styles.plate}`}>{car.plate}</p>}
        </div>
        <Link to={carPath(car.id)} className={styles.edit} aria-label={t('garage.edit', { car: name })}>
          <Pencil size={18} aria-hidden="true" />
        </Link>
      </div>
      {anyDate && (
        <ul className={styles.docs}>
          {CAR_DOCS.map(({ doc, column }) => (
            <li key={doc}>
              <DocPill doc={doc} date={car[column]} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** "ITP: în 12 zile" — text and color together, with a bell when it needs attention. */
function DocPill({ doc, date }: { doc: CarDoc; date: string | null }) {
  const { t, lang } = useI18n();
  const name = t(`doc.${doc}` as MessageKey);
  if (!date) return <span className={styles.pillMuted}>{t('garage.notSet', { doc: name })}</span>;
  const days = daysFromToday(date);
  const urgency = urgencyOf(days);
  const text =
    days < 0
      ? t('garage.expiredAgo', { doc: name, days: plural(lang, 'unit.days', -days) })
      : days === 0
        ? t('garage.today', { doc: name })
        : urgency === 'soon'
          ? t('garage.inDays', { doc: name, days: plural(lang, 'unit.days', days) })
          : t('garage.on', { doc: name, date: formatDayMonth(lang, date) });
  const cls = urgency === 'expired' ? styles.pillRed : urgency === 'soon' ? styles.pillAmber : styles.pillMuted;
  return (
    <span className={cls}>
      {urgency !== 'ok' && <Bell size={13} aria-hidden="true" />}
      {text}
    </span>
  );
}
