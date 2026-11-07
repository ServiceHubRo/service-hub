import { Copy } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { LoadError } from '../../components/LoadError';
import { PageHeader } from '../../components/PageHeader';
import { SkeletonList } from '../../components/Skeleton';
import { adminVehicleDuplicates, type DuplicateCar } from '../../data/garage';
import { adminZoneBack } from '../../app/adminZones';
import { useI18n } from '../../i18n/context';
import { plural } from '../../i18n/translate';
import { useLoad } from '../../lib/useLoad';
import { ADMIN_DUPLICATES_PATH, adminClientPath } from './paths';
import styles from './admin.module.css';
import own from './fleets.module.css';

/** „‹ Înapoi” goes to the screen's zone (A1). */
const ZONE_BACK = adminZoneBack(ADMIN_DUPLICATES_PATH);

/**
 * Vehicule duplicate (T66, platform admin): the same car recorded more than once by one owner, in a
 * personal garage or among a company's active vehicles. Read only: the owner merges them in the garage.
 */
export function VehicleDuplicatesScreen() {
  const { t } = useI18n();
  const { state, reload } = useLoad(adminVehicleDuplicates);

  let body;
  if (state.status === 'loading') body = <SkeletonList />;
  else if (state.status === 'error') body = <LoadError message={t('admin.dup.loadError')} onRetry={reload} />;
  else if (state.data.personal.length === 0 && state.data.company.length === 0) body = <EmptyState icon={Copy} title={t('admin.dup.empty')} />;
  else {
    const { personal, company } = state.data;
    body = (
      <>
        <p className={styles.muted}>{t('admin.dup.note')}</p>
        {personal.length > 0 && (
          <section className={styles.section} aria-labelledby="dup-personal">
            <h2 id="dup-personal" className={styles.sectionTitle}>
              {t('admin.dup.personal')}
            </h2>
            <ul className={own.list}>
              {personal.map((g) => (
                <li key={`${g.owner_id}-${g.key}`}>
                  <Card className={own.row}>
                    <div className={own.rowHead}>
                      <div className={own.rowText}>
                        <Link className={styles.link} to={adminClientPath(g.owner_id)}>
                          {g.email ?? g.owner_id}
                        </Link>
                        <span className={`mono ${styles.muted}`}>{g.key}</span>
                      </div>
                      <span className={`${styles.muted} ${own.dupCount}`}>{t('admin.dup.copies', { count: g.cars.length })}</span>
                    </div>
                    <CarList cars={g.cars} />
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        )}
        {company.length > 0 && (
          <section className={styles.section} aria-labelledby="dup-company">
            <h2 id="dup-company" className={styles.sectionTitle}>
              {t('admin.dup.company')}
            </h2>
            <ul className={own.list}>
              {company.map((g) => (
                <li key={`${g.company_id}-${g.vin}`}>
                  <Card className={own.row}>
                    <div className={own.rowHead}>
                      <div className={own.rowText}>
                        <span className={own.rowName}>{g.company}</span>
                        <span className={`mono ${styles.muted}`}>{g.vin}</span>
                      </div>
                      <span className={`${styles.muted} ${own.dupCount}`}>{t('admin.dup.copies', { count: g.vehicles.length })}</span>
                    </div>
                    <CarList cars={g.vehicles} />
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        )}
      </>
    );
  }

  return (
    <div className={styles.page}>
      <PageHeader back={{ to: ZONE_BACK.to, label: t(ZONE_BACK.label) }} title={t('admin.dup.title')} />
      {body}
    </div>
  );
}

function CarList({ cars }: { cars: (Pick<DuplicateCar, 'id' | 'make' | 'model' | 'plate'> & Partial<Pick<DuplicateCar, 'vin' | 'bookings'>>)[] }) {
  const { lang } = useI18n();
  return (
    <ul className={own.carList}>
      {cars.map((c) => (
        <li key={c.id}>
          {[`${c.make} ${c.model}`, c.plate, c.vin, c.bookings === undefined ? null : plural(lang, 'unit.bookings', c.bookings)]
            .filter(Boolean)
            .join(' · ')}
        </li>
      ))}
    </ul>
  );
}
