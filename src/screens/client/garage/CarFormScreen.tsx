import { CarFront, Trash2 } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ActionButton } from '../../../components/ActionButton';
import { BackLink } from '../../../components/BackLink';
import { useEmbedded } from '../../../lib/embedded';
import { PageHeader } from '../../../components/PageHeader';
import { Button } from '../../../components/Button';
import { buttonClass } from '../../../components/buttonClass';
import { Card } from '../../../components/Card';
import { EmptyState } from '../../../components/EmptyState';
import { Field } from '../../../components/Field';
import { LoadError } from '../../../components/LoadError';
import { SelectField } from '../../../components/SelectField';
import { SkeletonList } from '../../../components/Skeleton';
import { createCar, deleteCar, fetchCar, fetchOilStandard, updateCar, type Car, type CarFields } from '../../../data/garage';
import { canRetryRpc, rpcErrorMessage, toRpcError } from '../../../data/rpc';
import { useI18n } from '../../../i18n/context';
import { ymdInBucharest } from '../../../i18n/format';
import type { MessageKey } from '../../../i18n/ro';
import { plural } from '../../../i18n/translate';
import { carYearMax, isValidCarYear } from '../../../lib/car';
import { CAR_DOCS } from '../../../lib/expiry';
import { OIL_MONTH_CHOICES } from '../../../lib/oil';
import { newRequestId } from '../../../lib/requestId';
import { FOOT_ROW_QUERY, useMediaQuery } from '../../../lib/useMediaQuery';
import { useLoad } from '../../../lib/useLoad';
import { canonicalPlate, isValidPlate } from '../../../lib/plate';
import { isValidVin, normalizeCode } from '../../../lib/validators';
import { carPath as carEditPath, GARAGE_PATH } from '../paths';
import fleetStyles from '../../fleet/fleet.module.css';
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
      <PageHeader back={{ to: GARAGE_PATH, label: t('nav.client.garage') }} title={t('garage.editTitle')} />
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
type FieldName = 'make' | 'model' | 'plate' | 'year' | 'vin';
const FIELD_ORDER: readonly FieldName[] = ['make', 'model', 'year', 'plate', 'vin'];

function CarEditor({ car }: { car: Car | null }) {
  // On a phone the buttons fill the width, one under another; from 600 px they sit in one row.
  const narrow = !useMediaQuery(FOOT_ROW_QUERY);
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  // Beside the garage's list the title is a second-level heading (the page keeps one title).
  const Title = useEmbedded() ? 'h2' : 'h1';
  // The id of a new car is made once, so "Încearcă din nou" never adds it twice (data/garage.ts).
  const [newId] = useState(newRequestId);
  /** The car already in the garage when a save was refused as a copy (T66). */
  const [duplicateOf, setDuplicateOf] = useState<string | null>(null);
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
  const [oilMonths, setOilMonths] = useState(car?.oil_change_months ? String(car.oil_change_months) : '');
  const [oilLast, setOilLast] = useState(car?.last_oil_change ?? '');
  const { state: oilStandard } = useLoad(fetchOilStandard);
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const makeRef = useRef<HTMLInputElement>(null);
  const modelRef = useRef<HTMLInputElement>(null);
  const plateRef = useRef<HTMLInputElement>(null);
  const yearRef = useRef<HTMLInputElement>(null);
  const vinRef = useRef<HTMLInputElement>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const vinNorm = normalizeCode(vin);
  const today = ymdInBucharest(new Date());
  const oilLastError = oilLast && oilLast > today ? t('rpcError.car_oil_date_invalid') : null;
  const standardMonths = oilStandard.status === 'ready' ? oilStandard.data.months : null;
  /** A field changed: its message goes until the next save (as in the company's form). */
  const edited = (k: FieldName, set: (v: string) => void) => (v: string) => {
    set(v);
    setErrors((e) => ({ ...e, [k]: undefined }));
  };

  // No request id here: an edit gives the same result however often it is sent, and a new car
  // carries its own id (newId).
  async function save() {
    // The same checks, at the same moment, as „Adaugă vehicul” in a company's space.
    const next: Partial<Record<FieldName, string>> = {};
    if (!make.trim()) next.make = t('car.required');
    if (!model.trim()) next.model = t('car.required');
    if (year.trim() && !isValidCarYear(year.trim())) next.year = t('car.yearInvalid', { max: carYearMax() });
    // M7: a new or changed plate must be a plate; one already saved is left as it is.
    if (plate.trim() && canonicalPlate(plate) !== canonicalPlate(car?.plate) && !isValidPlate(plate)) next.plate = t('rpcError.car_plate_invalid');
    if (vinNorm && !isValidVin(vinNorm)) next.vin = t('rpcError.car_vin_invalid');
    setErrors(next);
    const first = FIELD_ORDER.find((k) => next[k]);
    if (first) {
      ({ make: makeRef, model: modelRef, year: yearRef, plate: plateRef, vin: vinRef })[first].current?.focus();
      return;
    }
    if (oilLastError) return;
    const fields: CarFields = {
      make: make.trim(),
      model: model.trim(),
      year: year.trim() ? Number(year.trim()) : null,
      plate: plate.trim().toUpperCase() || null,
      vin: vinNorm,
      itp_expiry: dates.itp_expiry || null,
      rca_expiry: dates.rca_expiry || null,
      vignette_expiry: dates.vignette_expiry || null,
      oil_change_months: oilMonths ? Number(oilMonths) : null,
      last_oil_change: oilLast || null,
    };
    try {
      if (car) await updateCar(car.id, fields);
      else await createCar(newId, fields);
    } catch (e) {
      // The same car is already in the garage (T66): the message says so, and a link opens it.
      const err = toRpcError(e);
      if (err.code === 'car_duplicate' && typeof err.params.car_id === 'string') setDuplicateOf(err.params.car_id);
      throw e;
    }
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

      {/* Exactly the card of „Adaugă vehicul” in a company's space (Eduard, 14 Nov 2026): the title in
          the card, equal fields that fill it, „Documente”, then the button across and „Renunță”. The
          oil change is the garage's own, built the same way as the documents. */}
      <Card data-ui="form-card" className={fleetStyles.card}>
        <Title className={fleetStyles.cardTitle}>{car ? t('garage.editTitle') : t('garage.add')}</Title>
        <form className={fleetStyles.stack} onSubmit={(e) => e.preventDefault()} noValidate>
          <div className={fleetStyles.formGrid}>
            <Field ref={makeRef} label={t('car.make')} placeholder={t('car.makePlaceholder')} value={make} maxLength={60} autoComplete="off" error={errors.make} onChange={(e) => edited('make', setMake)(e.target.value)} />
            <Field ref={modelRef} label={t('car.model')} placeholder={t('car.modelPlaceholder')} value={model} maxLength={60} autoComplete="off" error={errors.model} onChange={(e) => edited('model', setModel)(e.target.value)} />
            <Field
              ref={plateRef}
              label={t('car.plate')}
              placeholder={t('car.platePlaceholder')}
              value={plate}
              maxLength={20}
              mono
              upper
              autoCapitalize="characters"
              autoComplete="off"
              error={errors.plate}
              onChange={(e) => edited('plate', setPlate)(e.target.value.toUpperCase())}
            />
            <Field
              ref={yearRef}
              label={t('car.year')}
              value={year}
              inputMode="numeric"
              maxLength={4}
              mono
              autoComplete="off"
              error={errors.year}
              onChange={(e) => edited('year', setYear)(e.target.value.replace(/\D/g, ''))}
            />
            <Field
              ref={vinRef}
              label={t('car.vin')}
              hint={t('car.vinHint')}
              value={vin}
              maxLength={24}
              mono
              upper
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              error={errors.vin}
              onChange={(e) => edited('vin', setVin)(e.target.value.toUpperCase())}
            />
          </div>

          <h3 className={fleetStyles.subTitle}>{t('fleet.vtab.documents')}</h3>
          <div className={fleetStyles.formGrid}>
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
          </div>

          {/* T30: the client's own interval (else the catalog's) and a change made outside Service-Hub. */}
          <h3 className={fleetStyles.subTitle}>{t('garage.oilTitle')}</h3>
          <div className={fleetStyles.formGrid}>
            <SelectField
              label={t('garage.oilEvery')}
              value={oilMonths}
              options={[
                {
                  value: '',
                  label: standardMonths
                    ? t('garage.oilStandard', { months: plural(lang, 'unit.months', standardMonths) })
                    : t('garage.oilStandardNone'),
                },
                ...OIL_MONTH_CHOICES.map((n) => ({ value: String(n), label: plural(lang, 'unit.months', n) })),
              ]}
              onChange={(e) => setOilMonths(e.target.value)}
            />
            <Field
              type="date"
              label={t('garage.oilLast')}
              hint={t('garage.oilLastHint')}
              value={oilLast}
              max={today}
              error={oilLastError}
              onChange={(e) => setOilLast(e.target.value)}
            />
          </div>

          {car && confirmDelete ? (
            <div className={styles.confirm} role="group" aria-labelledby="delete-car-q">
              <p id="delete-car-q" className={styles.confirmTitle}>
                {t('garage.deleteConfirm')}
              </p>
              <p className={styles.sub}>{t('garage.deleteNote')}</p>
              <div className={styles.footMain}>
                <ActionButton block={narrow} variant="danger" onAction={remove} errorMessage={(e) => rpcErrorMessage(lang, e)} canRetry={canRetryRpc}>
                  {t('garage.deleteYes')}
                </ActionButton>
                <Button block={narrow} onClick={() => setConfirmDelete(false)}>{t('common.cancel')}</Button>
              </div>
            </div>
          ) : (
            /* One foot under a hairline: save and cancel on the right, delete — quiet, on the left. */
            <div className={styles.foot}>
              <div className={styles.footMain}>
                <ActionButton submit block={narrow} variant="primary" onAction={save} errorMessage={(e) => rpcErrorMessage(lang, e)} canRetry={canRetryRpc}>
                  {t('garage.saveCar')}
                </ActionButton>
                <Button block={narrow} onClick={() => navigate(GARAGE_PATH)}>{t('common.cancel')}</Button>
              </div>
              {car && (
                <Button variant="danger" block={narrow} onClick={() => setConfirmDelete(true)}>
                  <Trash2 size={16} aria-hidden="true" />
                  {t('garage.delete')}
                </Button>
              )}
            </div>
          )}
          {duplicateOf && (
            <Link to={carEditPath(duplicateOf)} className={buttonClass('secondary')}>
              {t('garage.openExisting')}
            </Link>
          )}
        </form>
      </Card>

    </div>
  );
}
