import { useRef, useState } from 'react';
import { ActionButton } from '../../components/ActionButton';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Field } from '../../components/Field';
import { SelectField } from '../../components/SelectField';
import type { VehicleFields } from '../../data/fleet';
import { rpcErrorMessage } from '../../data/rpc';
import { useI18n } from '../../i18n/context';
import { carYearMax, isValidCarYear } from '../../lib/car';
import type { FleetVehicle } from '../../lib/fleet';
import { isValidVin, normalizeCode } from '../../lib/validators';
import { useFleet } from './fleetContext';
import styles from './fleet.module.css';

const TYPES = ['car', 'van', 'truck', 'motorcycle', 'other'] as const;

type FieldName = 'make' | 'model' | 'year' | 'vin';

/**
 * A company vehicle, new or changed (T63c): the garage's fields (make, model, year, plate, VIN, the
 * three documents) plus the department and the type. The checks mirror `fleet_save_vehicle`, which
 * repeats them; a plate already in the active fleet is refused there.
 */
export function FleetVehicleForm({ vehicle, onDone, onCancel }: { vehicle: FleetVehicle | null; onDone: (v: FleetVehicle) => void; onCancel: () => void }) {
  const { t, lang } = useI18n();
  const { actions } = useFleet();
  const [f, setF] = useState<VehicleFields>({
    make: vehicle?.make ?? '',
    model: vehicle?.model ?? '',
    year: vehicle?.year ? String(vehicle.year) : '',
    plate: vehicle?.plate ?? '',
    vin: vehicle?.vin ?? '',
    itp_expiry: vehicle?.itp_expiry ?? '',
    rca_expiry: vehicle?.rca_expiry ?? '',
    vignette_expiry: vehicle?.vignette_expiry ?? '',
    department: vehicle?.department ?? '',
    vehicle_type: vehicle?.vehicle_type ?? 'car',
  });
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const makeRef = useRef<HTMLInputElement>(null);
  const modelRef = useRef<HTMLInputElement>(null);
  const yearRef = useRef<HTMLInputElement>(null);
  const vinRef = useRef<HTMLInputElement>(null);
  const set = (k: keyof VehicleFields, v: string) => {
    setF((x) => ({ ...x, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };

  async function save(requestId: string) {
    if (!actions) return;
    const next: Partial<Record<FieldName, string>> = {};
    if (!f.make.trim()) next.make = t('car.required');
    if (!f.model.trim()) next.model = t('car.required');
    if (f.year.trim() && !isValidCarYear(f.year.trim())) next.year = t('car.yearInvalid', { max: carYearMax() });
    const vin = normalizeCode(f.vin);
    if (vin && !isValidVin(vin)) next.vin = t('rpcError.car_vin_invalid');
    setErrors(next);
    const first = (['make', 'model', 'year', 'vin'] as const).find((k) => next[k]);
    if (first) {
      ({ make: makeRef, model: modelRef, year: yearRef, vin: vinRef })[first].current?.focus();
      return;
    }
    const saved = await actions.saveVehicle(vehicle?.id ?? null, { ...f, make: f.make.trim(), model: f.model.trim(), year: f.year.trim(), plate: f.plate.trim(), vin: vin ?? '' }, requestId);
    onDone(saved);
  }

  return (
    <Card className={styles.card}>
      <h2 className={styles.cardTitle}>{vehicle ? t('fleet.form.editVehicle') : t('fleet.vehicles.addTitle')}</h2>
      <form className={styles.stack} noValidate onSubmit={(e) => e.preventDefault()}>
        <div className={styles.formGrid}>
          <Field ref={makeRef} label={t('car.make')} placeholder={t('car.makePlaceholder')} value={f.make} maxLength={60} error={errors.make} onChange={(e) => set('make', e.target.value)} />
          <Field ref={modelRef} label={t('car.model')} placeholder={t('car.modelPlaceholder')} value={f.model} maxLength={60} error={errors.model} onChange={(e) => set('model', e.target.value)} />
          <Field label={t('car.plate')} placeholder={t('car.platePlaceholder')} value={f.plate} maxLength={20} mono upper onChange={(e) => set('plate', e.target.value.toUpperCase())} />
          <Field ref={yearRef} label={t('car.year')} inputMode="numeric" maxLength={4} mono value={f.year} error={errors.year} onChange={(e) => set('year', e.target.value)} />
          <Field ref={vinRef} label={t('car.vin')} hint={t('car.vinHint')} value={f.vin} maxLength={17} mono upper error={errors.vin} onChange={(e) => set('vin', e.target.value.toUpperCase())} />
          <SelectField label={t('fleet.col.type')} value={f.vehicle_type} onChange={(e) => set('vehicle_type', e.target.value)} options={TYPES.map((v) => ({ value: v, label: t(`fleet.type.${v}`) }))} />
          <Field label={t('fleet.col.department')} hint={t('cos.optional')} value={f.department} maxLength={60} onChange={(e) => set('department', e.target.value)} />
        </div>
        <h3 className={styles.subTitle}>{t('fleet.vtab.documents')}</h3>
        <div className={styles.formGrid}>
          <Field label={t('doc.long.itp')} type="date" value={f.itp_expiry} onChange={(e) => set('itp_expiry', e.target.value)} />
          <Field label={t('doc.long.rca')} type="date" value={f.rca_expiry} onChange={(e) => set('rca_expiry', e.target.value)} />
          <Field label={t('doc.long.vignette')} type="date" value={f.vignette_expiry} onChange={(e) => set('vignette_expiry', e.target.value)} />
        </div>
        <div className={styles.actions}>
          <ActionButton submit variant="primary" errorMessage={(e) => rpcErrorMessage(lang, e)} onAction={save}>
            {t('fleet.form.saveVehicle')}
          </ActionButton>
          <Button onClick={onCancel}>{t('common.cancel')}</Button>
        </div>
      </form>
    </Card>
  );
}
