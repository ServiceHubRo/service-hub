import { CarFront, ChevronRight, Download, Plus, SearchX } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '../../components/Button';
import { ChoiceFilters } from '../../components/Filters';
import { EmptyState } from '../../components/EmptyState';
import { InlinePanel } from '../../components/InlinePanel';
import { SearchField } from '../../components/SearchField';
import { useI18n } from '../../i18n/context';
import { formatDate, formatKm, formatMoney, ymdInBucharest } from '../../i18n/format';
import { csvFormat, toCsv } from '../../lib/history';
import {
  distinctValues,
  hasFeature,
  filterVehicles,
  ledgerFor,
  NO_FILTER,
  sortVehicles,
  vehicleRows,
  VEHICLE_SORTS,
  VEHICLE_STATUSES,
  yearRange,
  type VehicleFilter,
  type VehicleSort,
  type VehicleStatus,
} from '../../lib/fleet';
import { saveFile } from '../../lib/saveFile';
import { VehicleStatusPill } from './FleetPills';
import { FleetVehicleForm } from './FleetVehicleForm';
import { useFleet } from './fleetContext';
import styles from './fleet.module.css';

/**
 * Vehicule (docs/FLEET_PLAN.md §4): every car the member may see, searched by plate (with or without
 * spaces), make, model or VIN, filtered by status, driver, department and type, sorted by plate,
 * cost this year, kilometres, date added or last service. Archived cars stay one filter away, with
 * their history. The list exports as CSV exactly as filtered.
 */
export function FleetVehicles({ initialStatus }: { initialStatus?: string }) {
  const { t, lang } = useI18n();
  const { data, go, allowed, mode, plan } = useFleet();
  const today = ymdInBucharest(new Date());
  const ledger = useMemo(() => ledgerFor(data), [data]);
  const rows = useMemo(() => vehicleRows(data.vehicles, data.jobs, ledger?.entries ?? null, yearRange(today), data.expenses), [data, ledger, today]);
  const [filter, setFilter] = useState<VehicleFilter>(() => ({
    ...NO_FILTER,
    status: VEHICLE_STATUSES.includes(initialStatus as VehicleStatus) ? (initialStatus as VehicleStatus) : 'all',
  }));
  const [sort, setSort] = useState<VehicleSort>('plate');
  const [adding, setAdding] = useState(initialStatus === 'nou');
  const shown = useMemo(() => sortVehicles(filterVehicles(rows, filter), sort), [rows, filter, sort]);
  const drivers = data.members.filter((m) => m.role === 'driver' && m.accepted_at);
  const departments = distinctValues(data.vehicles, 'department');
  const types = distinctValues(data.vehicles, 'vehicle_type');
  const memberName = (id: string | null) => data.members.find((m) => m.id === id)?.name ?? null;
  const money = allowed('costs.view');
  const set = (patch: Partial<VehicleFilter>) => setFilter((f) => ({ ...f, ...patch }));
  const sorts = money ? VEHICLE_SORTS : VEHICLE_SORTS.filter((s) => s !== 'cost');
  const typeLabel = (v: string) => (['car', 'van', 'truck', 'motorcycle', 'other'].includes(v) ? t(`fleet.type.${v}` as 'fleet.type.car') : v);

  async function exportCsv() {
    const { separator } = csvFormat(lang);
    const header = [t('fleet.col.plate'), t('fleet.col.make'), t('fleet.col.model'), t('fleet.col.year'), t('fleet.col.vin'), t('fleet.col.status'), t('fleet.col.driver'), t('fleet.col.km')];
    if (money) header.push(t('fleet.col.costYear'));
    const body = shown.map((r) => {
      const row = [r.vehicle.plate ?? '', r.vehicle.make, r.vehicle.model, String(r.vehicle.year ?? ''), r.vehicle.vin ?? '', t(`fleet.status.${r.status}`), memberName(r.vehicle.driver_id) ?? '', r.odometer === null ? '' : String(r.odometer)];
      if (money) row.push(r.cost === null ? '' : String(r.cost).replace('.', csvFormat(lang).decimal));
      return row;
    });
    await saveFile(new Blob([toCsv([header, ...body], separator)], { type: 'text/csv;charset=utf-8' }), `${t('fleet.vehicles.file')}-${today}.csv`);
  }

  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <div className={styles.toolbarSearch}>
          <SearchField
            id="fleet-vehicle-search"
            label={t('fleet.vehicles.search')}
            placeholder={t('fleet.vehicles.searchPlaceholder')}
            value={filter.query}
            onChange={(query) => set({ query })}
            onClear={() => set({ query: '' })}
            clearLabel={t('fleet.vehicles.searchClear')}
          />
        </div>
        <div className={styles.toolbarActions}>
          {allowed('vehicles.manage') && (
            <Button variant="primary" onClick={() => setAdding((a) => !a)} aria-expanded={adding}>
              <Plus size={18} aria-hidden="true" /> {t('fleet.vehicles.add')}
            </Button>
          )}
        </div>
      </div>

      <ChoiceFilters
        groups={[
          {
            key: 'status',
            title: t('fleet.col.status'),
            options: [{ value: 'all', label: t('fleet.vehicles.all') }, ...VEHICLE_STATUSES.map((v) => ({ value: v, label: t(`fleet.status.${v}`) }))],
            value: filter.status,
            defaultValue: 'all',
            onChange: (v) => set({ status: v as VehicleFilter['status'] }),
          },
          ...(drivers.length > 0
            ? [
                {
                  key: 'driver',
                  title: t('fleet.col.driver'),
                  options: [{ value: '', label: t('fleet.vehicles.anyDriver') }, ...drivers.map((d) => ({ value: d.id, label: d.name }))],
                  value: filter.driverId ?? '',
                  defaultValue: '',
                  onChange: (v: string) => set({ driverId: v || null }),
                },
              ]
            : []),
          ...(departments.length > 0
            ? [
                {
                  key: 'department',
                  title: t('fleet.col.department'),
                  options: [{ value: '', label: t('fleet.vehicles.anyDepartment') }, ...departments.map((d) => ({ value: d, label: d }))],
                  value: filter.department ?? '',
                  defaultValue: '',
                  onChange: (v: string) => set({ department: v || null }),
                },
              ]
            : []),
          ...(types.length > 0
            ? [
                {
                  key: 'type',
                  title: t('fleet.col.type'),
                  options: [{ value: '', label: t('fleet.vehicles.anyType') }, ...types.map((v) => ({ value: v, label: typeLabel(v) }))],
                  value: filter.vehicleType ?? '',
                  defaultValue: '',
                  onChange: (v: string) => set({ vehicleType: v || null }),
                },
              ]
            : []),
          {
            key: 'sort',
            title: t('fleet.vehicles.sort'),
            options: sorts.map((v) => ({ value: v, label: t(`fleet.sort.${v}`) })),
            value: sort,
            defaultValue: 'plate',
            onChange: (v) => setSort(v as VehicleSort),
          },
        ]}
        onClearAll={() => {
          setFilter((f) => ({ ...NO_FILTER, query: f.query }));
          setSort('plate');
        }}
        doneLabel={t('fleet.filters.show', { n: shown.length })}
        end={
          shown.length > 0 && hasFeature(plan, 'export_csv') ? (
            <Button variant="ghost" className={styles.tool} onClick={() => void exportCsv()}>
              <Download size={18} aria-hidden="true" /> {t('fleet.export.csv')}
            </Button>
          ) : undefined
        }
      />

      {adding &&
        (mode === 'live' ? (
          <FleetVehicleForm
            vehicle={null}
            onCancel={() => setAdding(false)}
            onDone={(v) => {
              setAdding(false);
              go({ section: 'vehicul', vehicle: v.id });
            }}
          />
        ) : (
          <InlinePanel title={t('fleet.vehicles.addTitle')}>
            <p className={styles.note}>{t('fleet.vehicles.addPreview')}</p>
            <div>
              <Button onClick={() => setAdding(false)}>{t('fleet.close')}</Button>
            </div>
          </InlinePanel>
        ))}

      <p className={styles.count} aria-live="polite">
        {t('fleet.vehicles.count', { shown: shown.length, total: rows.filter((r) => r.status !== 'archived').length })}
      </p>

      {rows.length === 0 ? (
        <EmptyState icon={CarFront} title={t('fleet.empty.title')} body={t('fleet.empty.body')} />
      ) : shown.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title={t('fleet.vehicles.noMatch')}
          body={t('fleet.vehicles.noMatchBody')}
          action={<Button onClick={() => setFilter(NO_FILTER)}>{t('fleet.vehicles.reset')}</Button>}
        />
      ) : (
        <ul className={styles.vehicleList}>
          {shown.map((r) => (
            <li key={r.vehicle.id}>
              <button type="button" className={styles.vehicleRow} onClick={() => go({ section: 'vehicul', vehicle: r.vehicle.id })}>
                <span className={styles.vehicleMain}>
                  <span className={`mono ${styles.plate}`}>{r.vehicle.plate ?? t('fleet.vehicle.noPlate')}</span>
                  <span className={styles.vehicleName}>
                    {r.vehicle.make} {r.vehicle.model}
                    {r.vehicle.year ? ` · ${r.vehicle.year}` : ''}
                  </span>
                </span>
                <VehicleStatusPill status={r.status} />
                <span className={styles.vehicleFacts}>
                  <span>
                    <span className={styles.factLabel}>{t('fleet.col.driver')}</span>
                    {memberName(r.vehicle.driver_id) ?? <span className={styles.muted}>{t('fleet.vehicle.noDriver')}</span>}
                  </span>
                  <span>
                    <span className={styles.factLabel}>{t('fleet.col.km')}</span>
                    <span className="mono">{r.odometer === null ? '—' : formatKm(lang, r.odometer)}</span>
                  </span>
                  {money && (
                    <span>
                      <span className={styles.factLabel}>{t('fleet.col.costYear')}</span>
                      <span className="mono">{formatMoney(lang, r.cost ?? 0)}</span>
                    </span>
                  )}
                  <span>
                    <span className={styles.factLabel}>{t('fleet.col.lastService')}</span>
                    {r.lastService ? formatDate(lang, r.lastService) : <span className={styles.muted}>—</span>}
                  </span>
                </span>
                <ChevronRight size={18} className={styles.chevron} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
