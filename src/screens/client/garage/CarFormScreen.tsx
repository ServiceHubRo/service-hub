import { CarFront } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ActionButton } from '../../../components/ActionButton';
import { BackLink } from '../../../components/BackLink';
import { Button } from '../../../components/Button';
import { buttonClass } from '../../../components/buttonClass';
import { Card } from '../../../components/Card';
import { EmptyState } from '../../../components/EmptyState';
import { Field } from '../../../components/Field';
import { LoadError } from '../../../components/LoadError';
import { SkeletonList } from '../../../components/Skeleton';
import { createCar, deleteCar, fetchCar, updateCar, type Car, type CarFields } from '../../../data/garage';
import { canRetryRpc, rpcErrorMessage } from '../../../data/rpc';
import { useI18n } from '../../../i18n/context';
import type { MessageKey } from '../../../i18n/ro';
import { carYearMax, isValidCarYear } from '../../../lib/car';
import { CAR_DOCS } from '../../../lib/expiry';
import { newRequestId } from '../../../lib/requestId';
import { useLoad } from '../../../lib/useLoad';
import { isValidVin, normalizeCode } from '../../../lib/validators';
import { GARAGE_PATH } from '../paths';
import styles from './garage.module.css';

/** Garaj → "Adaugă mașină" (`/c/garaj/nou`) or the pencil on a car (`/c/garaj/:carId`). */
export function CarFormScreen() {
  const { t } = useI18n();
  const { carId } = useParams();
  const load = useCallback(() => (carId ? fetchCar(carId) : Promise.resolve(null)), [carId]);
  const { state, reload } = useLoad(load);

  if (!carId) return <CarEditor car={null} />;
  if (state.status === 'ready' && state.data) return <CarEditor key={state.data.id} car={state.data} />;
  return (
    <div className={styles.page}>
      <BackLink to={GARAGE_PATH} label={t('nav.client.garage')} />
      <h1>{t('garage.editTitle')}</h1>
      {state.status === 'loading' && <SkeletonList count={2} />}
      {state.status === 'error' && <LoadError message={t('garage.loadError')} onRetry={reload} />}
      {state.status === 'ready' && (
        <EmptyState
          icon={CarFront}
          title={t('garage.notFound')}
          action={
            <Link to={GARAGE_PATH} className={buttonClass('primary')}>
              {t('nav.client.garage')}
            </Link>
          }
        />
      )}
    </div>
  );
}

type DateKey = (typeof CAR_DOCS)[number]['column'];

function CarEditor({ car }: { car: Car | null }) {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  // The id of a new car is made once, so "Încearcă din nou" never adds it twice (data/garage.ts).
  const [newId] = useState(newRequestId);
  const [make, setMake] = useState(car?.make ?? '');
  const [model, setModel] = useState(car?.model ?? '');
  const [year, setYear] = useState(car?.year ? String(car.year) : '');
  const [plate, setPlate] = useState(car?.plate ?? '');
  const [vin, setVin] = useState(car?.vin ?? '');
  const [dates, setDates] = useState<Record<DateKey, string>>({
    itp_expiry: car?.itp_expiry ?? '',
    rca_expiry: car?.rca_expiry ?? '',
    vignette_expiry: car?.vignette_expiry ?? '',
  });
  const [touched, setTouched] = useState({ year: false, vin: false });
  const [confirmDelete, setConfirmDelete] = useState(false);

  const vinNorm = normalizeCode(vin);
  const yearError = isValidCarYear(year) ? null : t('car.yearInvalid', { max: carYearMax() });
  const vinError = vinNorm && !isValidVin(vinNorm) ? t('rpcError.car_vin_invalid') : null;
  const filled = make.trim() !== '' && model.trim() !== '';
  const canSave = filled && !yearError && !vinError;

  // No request id here: an edit gives the same result however often it is sent, and a new car
  // carries its own id (newId).
  async function save() {
    const fields: CarFields = {
      make: make.trim(),
      model: model.trim(),
      year: year.trim() ? Number(year.trim()) : null,
      plate: plate.trim().toUpperCase() || null,
      vin: vinNorm,
      itp_expiry: dates.itp_expiry || null,
      rca_expiry: dates.rca_expiry || null,
      vignette_expiry: dates.vignette_expiry || null,
    };
    if (car) await updateCar(car.id, fields);
    else await createCar(newId, fields);
    navigate(GARAGE_PATH);
  }

  async function remove() {
    if (!car) return;
    await deleteCar(car.id);
    navigate(GARAGE_PATH, { replace: true });
  }

  return (
    <div className={styles.page}>
      <BackLink to={GARAGE_PATH} label={t('nav.client.garage')} />
      <h1>{car ? t('garage.editTitle') : t('garage.newTitle')}</h1>

      <form className={styles.form} onSubmit={(e) => e.preventDefault()} noValidate>
        <div className={styles.pair}>
          <Field label={t('car.make')} placeholder={t('car.makePlaceholder')} value={make} maxLength={60} autoComplete="off" onChange={(e) => setMake(e.target.value)} />
          <Field label={t('car.model')} placeholder={t('car.modelPlaceholder')} value={model} maxLength={60} autoComplete="off" onChange={(e) => setModel(e.target.value)} />
        </div>
        <div className={styles.pair}>
          <Field
            label={t('car.year')}
            value={year}
            inputMode="numeric"
            maxLength={4}
            mono
            autoComplete="off"
            error={touched.year ? yearError : null}
            onBlur={() => setTouched((s) => ({ ...s, year: true }))}
            onChange={(e) => setYear(e.target.value.replace(/\D/g, ''))}
          />
          <Field
            label={t('car.plate')}
            placeholder={t('car.platePlaceholder')}
            value={plate}
            maxLength={20}
            mono
            upper
            autoCapitalize="characters"
            autoComplete="off"
            onChange={(e) => setPlate(e.target.value)}
          />
        </div>
        <Field
          label={t('car.vin')}
          hint={t('car.vinHint')}
          value={vin}
          maxLength={24}
          mono
          upper
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          error={touched.vin ? vinError : null}
          onBlur={() => setTouched((s) => ({ ...s, vin: true }))}
          onChange={(e) => setVin(e.target.value)}
        />

        <Card inset className={styles.docsPanel}>
          <p className={styles.panelTitle}>{t('garage.docsTitle')}</p>
          <p className={styles.sub}>{t('garage.docsHint')}</p>
          {CAR_DOCS.map(({ doc, column }) => (
            <Field
              key={doc}
              type="date"
              label={t(`doc.long.${doc}` as MessageKey)}
              value={dates[column]}
              onChange={(e) => {
                const value = e.target.value;
                setDates((d) => ({ ...d, [column]: value }));
              }}
            />
          ))}
        </Card>

        {!filled && <p className={styles.sub}>{t('car.required')}</p>}
        <ActionButton submit onAction={save} disabled={!canSave} errorMessage={(e) => rpcErrorMessage(lang, e)} canRetry={canRetryRpc}>
          {t('common.save')}
        </ActionButton>
      </form>

      {car &&
        (confirmDelete ? (
          <Card className={styles.confirm} role="group" aria-labelledby="delete-car-q">
            <p id="delete-car-q" className={styles.confirmTitle}>
              {t('garage.deleteConfirm')}
            </p>
            <p className={styles.sub}>{t('garage.deleteNote')}</p>
            <div className={styles.confirmActions}>
              <ActionButton variant="danger" onAction={remove} errorMessage={(e) => rpcErrorMessage(lang, e)} canRetry={canRetryRpc}>
                {t('garage.deleteYes')}
              </ActionButton>
              <Button block onClick={() => setConfirmDelete(false)}>
                {t('common.cancel')}
              </Button>
            </div>
          </Card>
        ) : (
          <Button variant="danger" block onClick={() => setConfirmDelete(true)}>
            {t('garage.delete')}
          </Button>
        ))}
    </div>
  );
}
