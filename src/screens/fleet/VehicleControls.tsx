import { Archive, ArchiveRestore, Ban, CircleCheck, Pencil } from 'lucide-react';
import { useState } from 'react';
import { ActionButton } from '../../components/ActionButton';
import { Button } from '../../components/Button';
import { MoreActions } from '../../components/MoreActions';
import { SelectField } from '../../components/SelectField';
import { rpcErrorMessage } from '../../data/rpc';
import { useI18n } from '../../i18n/context';
import type { FleetVehicle } from '../../lib/fleet';
import { useFleet } from './fleetContext';
import styles from './fleet.module.css';

type Confirm = 'unavailable' | 'archive' | null;

/**
 * The live space's controls for one vehicle (T63c; admin and fleet manager). One action in sight —
 * who drives it — and the rest behind "Mai multe" (Eduard, 31 Oct: not a pile of buttons): edit,
 * mark unavailable or available, archive (history kept) or bring back. A change that affects use
 * of the vehicle asks first, inside the page. Each is a database function that checks the role
 * again and logs the change.
 */
export function VehicleControls({ vehicle, onEdit }: { vehicle: FleetVehicle; onEdit: () => void }) {
  const { t, lang } = useI18n();
  const { data, actions } = useFleet();
  const [driver, setDriver] = useState(vehicle.driver_id ?? '');
  const [confirm, setConfirm] = useState<Confirm>(null);
  const members = data.members.filter((m) => m.accepted_at);
  const archived = !!vehicle.archived_at;
  if (!actions) return null;
  const err = (e: unknown) => rpcErrorMessage(lang, e);

  const items = archived
    ? [{ key: 'unarchive', label: t('fleet.vehicle.unarchive'), icon: <ArchiveRestore size={18} aria-hidden="true" />, onSelect: () => setConfirm('archive') }]
    : [
        { key: 'edit', label: t('fleet.form.editVehicle'), icon: <Pencil size={18} aria-hidden="true" />, onSelect: onEdit },
        {
          key: 'unavailable',
          label: vehicle.unavailable ? t('fleet.vehicle.available') : t('fleet.vehicle.markUnavailable'),
          icon: vehicle.unavailable ? <CircleCheck size={18} aria-hidden="true" /> : <Ban size={18} aria-hidden="true" />,
          onSelect: () => setConfirm('unavailable'),
        },
        { key: 'archive', label: t('fleet.vehicle.archive'), icon: <Archive size={18} aria-hidden="true" />, onSelect: () => setConfirm('archive'), danger: true },
      ];

  return (
    <div className={styles.stack}>
      <div className={styles.assignRow}>
        {!archived ? (
          <>
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
          </>
        ) : (
          <p className={styles.note}>{t('fleet.vehicle.archivedNote')}</p>
        )}
        <div className={styles.moreEnd}>
          <MoreActions items={items} />
        </div>
      </div>

      {confirm === 'unavailable' && (
        <div className={styles.confirm}>
          <p>{vehicle.unavailable ? t('fleet.vehicle.availableConfirm') : t('fleet.vehicle.unavailableConfirm')}</p>
          <div className={styles.actions}>
            <ActionButton
              block={false}
              errorMessage={err}
              onAction={async (requestId) => {
                await actions.setUnavailable(vehicle.id, !vehicle.unavailable, requestId);
                setConfirm(null);
              }}
            >
              {vehicle.unavailable ? t('fleet.vehicle.available') : t('fleet.vehicle.markUnavailable')}
            </ActionButton>
            <Button onClick={() => setConfirm(null)}>{t('common.cancel')}</Button>
          </div>
        </div>
      )}

      {confirm === 'archive' && (
        <div className={styles.confirm}>
          <p>{archived ? t('fleet.vehicle.unarchiveConfirm') : t('fleet.vehicle.archiveConfirm')}</p>
          <div className={styles.actions}>
            <ActionButton
              block={false}
              variant={archived ? 'primary' : 'danger'}
              errorMessage={err}
              onAction={async (requestId) => {
                await actions.archiveVehicle(vehicle.id, !archived, requestId);
                setConfirm(null);
              }}
            >
              {archived ? t('fleet.vehicle.unarchive') : t('fleet.vehicle.archiveYes')}
            </ActionButton>
            <Button onClick={() => setConfirm(null)}>{t('common.cancel')}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
