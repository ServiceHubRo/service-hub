import { Copy } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { buttonClass } from '../../components/buttonClass';
import { EmptyState } from '../../components/EmptyState';
import { LoadError } from '../../components/LoadError';
import { PageHeader } from '../../components/PageHeader';
import { DetailPane, ListDetailLayout } from '../../components/ListDetailLayout';
import { ListRow, ListRows, ListRowsSkeleton } from '../../components/ListRow';
import { adminVehicleDuplicates, type DuplicateCar } from '../../data/garage';
import { adminZoneBack } from '../../app/adminZones';
import { useI18n } from '../../i18n/context';
import { plural } from '../../i18n/translate';
import { useListDetail } from '../../lib/useListDetail';
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
  const { pathname } = useLocation();
  const { state, reload } = useLoad(adminVehicleDuplicates);

  // Page template A (docs/MODEL_DE_FOLOSIRE.md P8): one row per group of copies (a person's garage, a
  // company's vehicles), the chosen one beside the list from 1024 px (in its place below).
  const personal = state.status === 'ready' ? state.data.personal : [];
  const company = state.status === 'ready' ? state.data.company : [];
  const { wide, selectedId, open, select } = useListDetail(
    [...personal.map((g) => `p:${g.owner_id}-${g.key}`), ...company.map((g) => `c:${g.company_id}-${g.vin}`)],
    'grup',
  );
  const chosenPersonal = personal.find((g) => `p:${g.owner_id}-${g.key}` === selectedId) ?? null;
  const chosenCompany = company.find((g) => `c:${g.company_id}-${g.vin}` === selectedId) ?? null;

  let list;
  if (state.status === 'loading') list = <ListRowsSkeleton label={t('common.loading')} />;
  else if (state.status === 'error') list = <LoadError message={t('admin.dup.loadError')} onRetry={reload} />;
  else if (personal.length === 0 && company.length === 0) list = <EmptyState icon={Copy} title={t('admin.dup.empty')} />;
  else
    list = (
      <>
        <p className={styles.muted}>{t('admin.dup.note')}</p>
        {personal.length > 0 && (
          <section className={styles.section} aria-labelledby="dup-personal">
            <h2 id="dup-personal" className={styles.sectionTitle}>
              {t('admin.dup.personal')}
            </h2>
            <ListRows label={t('admin.dup.personal')}>
              {personal.map((g) => (
                <ListRow
                  key={`${g.owner_id}-${g.key}`}
                  icon={<Copy size={20} />}
                  title={g.email ?? g.owner_id ?? ''}
                  detail={[g.key, t('admin.dup.copies', { count: g.cars.length })].join(' · ')}
                  selected={wide && selectedId === `p:${g.owner_id}-${g.key}`}
                  onSelect={() => select(`p:${g.owner_id}-${g.key}`)}
                />
              ))}
            </ListRows>
          </section>
        )}
        {company.length > 0 && (
          <section className={styles.section} aria-labelledby="dup-company">
            <h2 id="dup-company" className={styles.sectionTitle}>
              {t('admin.dup.company')}
            </h2>
            <ListRows label={t('admin.dup.company')}>
              {company.map((g) => (
                <ListRow
                  key={`${g.company_id}-${g.vin}`}
                  icon={<Copy size={20} />}
                  title={g.company ?? ''}
                  detail={[g.vin, t('admin.dup.copies', { count: g.vehicles.length })].join(' · ')}
                  selected={wide && selectedId === `c:${g.company_id}-${g.vin}`}
                  onSelect={() => select(`c:${g.company_id}-${g.vin}`)}
                />
              ))}
            </ListRows>
          </section>
        )}
      </>
    );

  return (
    <div className={styles.page}>
      <ListDetailLayout
        wide={wide}
        open={open}
        backTo={pathname}
        backLabel={t('admin.dup.title')}
        header={<PageHeader back={{ to: ZONE_BACK.to, label: t(ZONE_BACK.label) }} title={t('admin.dup.title')} />}
        list={list}
        detail={
          chosenPersonal ? (
            <DetailPane
              key={selectedId}
              id={`${chosenPersonal.owner_id}-${chosenPersonal.key}`}
              icon={<Copy size={20} />}
              title={chosenPersonal.email ?? chosenPersonal.owner_id ?? ''}
              detail={chosenPersonal.key}
              status={<span className={styles.muted}>{t('admin.dup.copies', { count: chosenPersonal.cars.length })}</span>}
              actions={
                <Link className={buttonClass('secondary')} to={adminClientPath(chosenPersonal.owner_id)}>
                  {t('admin.clients.open')}
                </Link>
              }
            >
              <CarList cars={chosenPersonal.cars} />
            </DetailPane>
          ) : chosenCompany ? (
            <DetailPane
              key={selectedId}
              id={`${chosenCompany.company_id}-${chosenCompany.vin}`}
              icon={<Copy size={20} />}
              title={chosenCompany.company ?? ''}
              detail={chosenCompany.vin}
              status={<span className={styles.muted}>{t('admin.dup.copies', { count: chosenCompany.vehicles.length })}</span>}
            >
              <CarList cars={chosenCompany.vehicles} />
            </DetailPane>
          ) : null
        }
      />
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
