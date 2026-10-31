import { useState } from 'react';
import { ActionButton } from '../../components/ActionButton';
import { Button } from '../../components/Button';
import { SelectField } from '../../components/SelectField';
import { rpcErrorMessage } from '../../data/rpc';
import { useI18n } from '../../i18n/context';
import type { FleetVehicle } from '../../lib/fleet';
import { useFleet } from './fleetContext';
import styles from './fleet.module.css';

/**
 * The live space's controls for one vehicle (T63c; admin and fleet manager): change the details,
 * assign it to a member, mark it unavailable, archive it (history kept) or bring it back. Each is a
 * database function that checks the role again and logs the change; the archive asks first.
 */
export function VehicleControls({ vehicle, onEdit }: { vehicle: FleetVehicle; onEdit: () => void }) {
  const { t, lang } = useI18n();
  const { data, actions } = useFleet();
  const [driver, setDriver] = useState(vehicle.driver_id ?? '');
  const [confirmArchive, setConfirmArchive] = useState(false);
  const members = data.members.filter((m) => m.accepted_at);
  const archived = !!vehicle.archived_at;
  if (!actions) return null;
  const err = (e: unknown) => rpcErrorMessage(lang, e);

  return (
    <div className={styles.stack}>
      {!archived && (
        <div className={styles.assignRow}>
          <SelectField
            label={t('fleet.vehicle.assignTo')}
            value={driver}
            onChange={(e) => setDriver(e.target.value)}
            options={[{ value: '', label: t('fleet.vehicle.noDriver') }, ...members.map((m) => ({ value: m.id, label: `${m.name || m.email} · ${t(`fleet.role.${m.role}`)}` }))]}
          />
          <ActionButton
            block={false}
            disabled={driver === (vehicle.driver_id ?? '')}
            errorMessage={err}
            onAction={(requestId) => actions.assignDriver(vehicle.id, driver || null, requestId)}
          >
            {t('fleet.vehicle.assign')}
          </ActionButton>
        </div>
      )}
      <div className={styles.actions}>
        {!archived && <Button onClick={onEdit}>{t('fleet.form.editVehicle')}</Button>}
        {!archived && (
          <ActionButton block={false} variant="secondary" errorMessage={err} onAction={(requestId) => actions.setUnavailable(vehicle.id, !vehicle.unavailable, requestId)}>
            {vehicle.unavailable ? t('fleet.vehicle.available') : t('fleet.vehicle.markUnavailable')}
          </ActionButton>
        )}
        {archived ? (
          <ActionButton block={false} variant="secondary" errorMessage={err} onAction={(requestId) => actions.archiveVehicle(vehicle.id, false, requestId)}>
            {t('fleet.vehicle.unarchive')}
          </ActionButton>
        ) : (
          !confirmArchive && (
            <Button variant="ghost" onClick={() => setConfirmArchive(true)}>
              {t('fleet.vehicle.archive')}
            </Button>
          )
        )}
      </div>
      {confirmArchive && !archived && (
        <div className={styles.confirm}>
          <p>{t('fleet.vehicle.archiveConfirm')}</p>
          <div className={styles.actions}>
            <ActionButton block={false} variant="danger" errorMessage={err} onAction={(requestId) => actions.archiveVehicle(vehicle.id, true, requestId)}>
              {t('fleet.vehicle.archiveYes')}
            </ActionButton>
            <Button onClick={() => setConfirmArchive(false)}>{t('common.cancel')}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
