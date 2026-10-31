import { AlertTriangle, ArrowLeft, CalendarPlus, FileText, Info } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Chip, ChipRow } from '../../components/Chip';
import { EmptyState } from '../../components/EmptyState';
import { SelectField } from '../../components/SelectField';
import { useI18n } from '../../i18n/context';
import { formatDate, formatKm, formatMoney } from '../../i18n/format';
import { CAR_DOCS } from '../../lib/expiry';
import {
  buildLedger,
  documentStates,
  jobEndDay,
  jobStage,
  lastOdometer,
  partsAndLabor,
  sumAmounts,
  vehicleStatus,
  type FleetJob,
} from '../../lib/fleet';
import { isActiveStatus } from '../../lib/status';
import { JobStagePill, SourcePill, VehicleStatusPill } from './FleetPills';
import { FleetQuoteCard } from './FleetQuoteCard';
import { FleetVehicleForm } from './FleetVehicleForm';
import { VehicleControls } from './VehicleControls';
import { useFleet } from './fleetContext';
import pill from '../../components/StatusBadge.module.css';
import styles from './fleet.module.css';

type Tab = 'overview' | 'history' | 'costs' | 'bookings' | 'quotes' | 'documents' | 'driver' | 'notes';

/**
 * One company car (docs/FLEET_PLAN.md §4): eight sections on one page. The history is the car's
 * finished Service-Hub jobs — nothing typed twice — and says plainly that it holds only what passed
 * through Service-Hub or was typed in by the company. Estimates, approvals and final costs keep
 * their own words; only the final cost is money spent.
 */
export function FleetVehicle({ vehicleId }: { vehicleId: string }) {
  const { t, lang } = useI18n();
  const { data, go, allowed, vehicle, mode, actions } = useFleet();
  const [editing, setEditing] = useState(false);
  const v = vehicle(vehicleId);
  const [tab, setTab] = useState<Tab>('overview');
  const jobs = useMemo(() => data.jobs.filter((j) => j.vehicle_id === vehicleId), [data.jobs, vehicleId]);
  const money = allowed('costs.view');
  const ledger = useMemo(() => (money ? buildLedger(jobs, data.expenses.filter((e) => e.vehicle_id === vehicleId)) : null), [money, jobs, data.expenses, vehicleId]);

  if (!v) {
    return (
      <EmptyState
        icon={Info}
        title={t('fleet.vehicle.notFound')}
        body={t('fleet.vehicle.notFoundBody')}
        action={<Button onClick={() => go({ section: 'vehicule' })}>{t('fleet.vehicle.back')}</Button>}
      />
    );
  }

  const status = vehicleStatus(v, data.jobs);
  const km = lastOdometer(v.id, data.jobs, data.expenses);
  const done = jobs.filter((j) => j.status === 'done').sort((a, b) => jobEndDay(b).localeCompare(jobEndDay(a)));
  const active = jobs.filter((j) => isActiveStatus(j.status));
  const quoted = jobs.filter((j) => j.quote).sort((a, b) => (b.quote!.sent_at ?? '').localeCompare(a.quote!.sent_at ?? ''));
  const docs = documentStates([v]);
  const issues = data.issues.filter((i) => i.vehicle_id === v.id);
  const driver = data.members.find((m) => m.id === v.driver_id);
  const memberName = (id: string | null) => data.members.find((m) => m.id === id)?.name ?? t('fleet.member.someone');

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'overview', label: t('fleet.vtab.overview') },
    { key: 'history', label: t('fleet.vtab.history'), count: done.length },
    ...(money ? [{ key: 'costs' as const, label: t('fleet.vtab.costs') }] : []),
    { key: 'bookings', label: t('fleet.vtab.bookings'), count: active.length },
    { key: 'quotes', label: t('fleet.vtab.quotes'), count: quoted.filter((j) => j.status === 'quote_sent').length },
    { key: 'documents', label: t('fleet.vtab.documents') },
    { key: 'driver', label: t('fleet.vtab.driver') },
    { key: 'notes', label: t('fleet.vtab.notes'), count: issues.filter((i) => i.status !== 'closed').length },
  ];

  return (
    <div className={styles.stack}>
      <div>
        <Button variant="ghost" onClick={() => go({ section: 'vehicule' })}>
          <ArrowLeft size={18} aria-hidden="true" /> {t('fleet.vehicle.back')}
        </Button>
      </div>
      <Card className={styles.vehicleHead}>
        <div className={styles.vehicleHeadTop}>
          <div className={styles.vehicleHeadText}>
            <h2 className={`mono ${styles.plateBig}`}>{v.plate ?? t('fleet.vehicle.noPlate')}</h2>
            <p className={styles.vehicleName}>
              {v.make} {v.model}
              {v.year ? ` · ${v.year}` : ''}
            </p>
          </div>
          <VehicleStatusPill status={status} />
        </div>
        <dl className={styles.facts}>
          <Fact label={t('fleet.col.km')} value={km === null ? null : formatKm(lang, km)} hint={t('fleet.vehicle.kmHint')} />
          <Fact label={t('fleet.col.vin')} value={v.vin} mono />
          <Fact label={t('fleet.col.driver')} value={driver?.name ?? null} />
          {money && ledger && <Fact label={t('fleet.vehicle.totalCost')} value={formatMoney(lang, sumAmounts(ledger.entries))} mono />}
        </dl>
      </Card>

      {editing && (
        <FleetVehicleForm vehicle={v} onCancel={() => setEditing(false)} onDone={() => setEditing(false)} />
      )}

      <div className={styles.sectionSelect}>
        <SelectField
          label={t('fleet.vehicle.sections')}
          value={tab}
          onChange={(e) => setTab(e.target.value as Tab)}
          options={tabs.map((x) => ({ value: x.key, label: x.count ? `${x.label} (${x.count})` : x.label }))}
        />
      </div>
      <div className={styles.sectionTabs}>
        <ChipRow label={t('fleet.vehicle.sections')}>
          {tabs.map((x) => (
            <Chip key={x.key} selected={tab === x.key} onClick={() => setTab(x.key)}>
              {x.label}
              {x.count ? <span className={styles.chipCount}>{x.count}</span> : null}
            </Chip>
          ))}
        </ChipRow>
      </div>

      {tab === 'overview' && (
        <div className={styles.grid2}>
          <Card className={styles.card}>
            <h3 className={styles.cardTitle}>{t('fleet.vehicle.next')}</h3>
            {active.length > 0 ? (
              <ul className={styles.plainList}>
                {active.map((j) => (
                  <li key={j.id} className={styles.lineRow}>
                    <span>
                      {lang === 'ro' ? j.service_name_ro : j.service_name_en}
                      <span className={styles.muted}> · {j.shop_name} · {formatDate(lang, j.date)}</span>
                    </span>
                    <JobStagePill stage={jobStage(j)} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.note}>{t('fleet.vehicle.nothingOpen')}</p>
            )}
            {mode === 'live' && actions && allowed('bookings.create') && !v.archived_at && (
              <div className={styles.actions}>
                <Button variant="primary" onClick={() => actions.book(v.id)}>
                  <CalendarPlus size={18} aria-hidden="true" /> {t('fleet.vehicle.book')}
                </Button>
              </div>
            )}
            {mode === 'preview' && (
              <>
                <div className={styles.actions}>
                  {allowed('bookings.create') && (
                    <Button variant="primary" disabled title={t('fleet.preview.notSaved')}>
                      <CalendarPlus size={18} aria-hidden="true" /> {t('fleet.vehicle.book')}
                    </Button>
                  )}
                  {allowed('issues.report') && (
                    <Button disabled title={t('fleet.preview.notSaved')}>
                      <AlertTriangle size={18} aria-hidden="true" /> {t('fleet.vehicle.report')}
                    </Button>
                  )}
                </div>
                <p className={styles.hintLine}>{t('fleet.preview.actionsLater')}</p>
              </>
            )}
          </Card>
          <Card className={styles.card}>
            <h3 className={styles.cardTitle}>{t('fleet.vtab.documents')}</h3>
            {docList(docs)}
          </Card>
        </div>
      )}

      {tab === 'history' && (
        <Card className={styles.card}>
          <p className={styles.note}>{t('fleet.history.scope')}</p>
          {done.length === 0 ? (
            <p className={styles.note}>{t('fleet.history.none')}</p>
          ) : (
            <ol className={styles.timeline}>
              {done.map((j) => (
                historyItem(j)
              ))}
            </ol>
          )}
        </Card>
      )}

      {tab === 'costs' && ledger && (
        <Card className={styles.card}>
          <div className={styles.cardHead}>
            <h3 className={styles.cardTitle}>{t('fleet.vtab.costs')}</h3>
            <span className={`mono ${styles.total}`}>{formatMoney(lang, sumAmounts(ledger.entries))}</span>
          </div>
          {ledger.entries.length === 0 ? (
            <p className={styles.note}>{t('fleet.costs.none')}</p>
          ) : (
            <ul className={styles.plainList}>
              {ledger.entries.map((e) => (
                <li key={e.id} className={styles.lineRow}>
                  <span className={styles.lineText}>
                    <span>
                      {t(`fleet.cat.${e.category}`)}
                      {e.fee ? ` · ${t('fleet.costs.fee')}` : ''}
                    </span>
                    <span className={styles.muted}>
                      {formatDate(lang, e.day)}
                      {e.vendor ? ` · ${e.vendor}` : ''}
                    </span>
                  </span>
                  <span className={styles.lineEnd}>
                    <SourcePill source={e.source} />
                    <span className="mono">{formatMoney(lang, e.amount)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {ledger.duplicates.length > 0 && <p className={styles.hintLine}>{t('fleet.costs.duplicates', { n: ledger.duplicates.length })}</p>}
          {ledger.foreign.length > 0 && <p className={styles.hintLine}>{t('fleet.costs.foreign', { n: ledger.foreign.length })}</p>}
        </Card>
      )}

      {tab === 'bookings' && (
        <Card className={styles.card}>
          {jobs.length === 0 ? (
            <p className={styles.note}>{t('fleet.bookings.none')}</p>
          ) : (
            <ul className={styles.plainList}>
              {[...jobs]
                .sort((a, b) => `${b.date} ${b.slot}`.localeCompare(`${a.date} ${a.slot}`))
                .map((j) => (
                  <li key={j.id} className={styles.lineRow}>
                    <span className={styles.lineText}>
                      <span>{lang === 'ro' ? j.service_name_ro : j.service_name_en}</span>
                      <span className={styles.muted}>
                        <span className="mono">{j.ref}</span> · {j.shop_name}, {j.shop_city} · {formatDate(lang, j.date)} {j.slot.slice(0, 5)}
                      </span>
                    </span>
                    <JobStagePill stage={jobStage(j)} />
                  </li>
                ))}
            </ul>
          )}
        </Card>
      )}

      {tab === 'quotes' && (
        <div className={styles.stack}>
          {quoted.length === 0 ? (
            <Card className={styles.card}>
              <p className={styles.note}>{t('fleet.quotes.none')}</p>
            </Card>
          ) : (
            quoted.map((j) => <FleetQuoteCard key={j.id} job={j} />)
          )}
        </div>
      )}

      {tab === 'documents' && (
        <Card className={styles.card}>
          {docList(docs)}
          <p className={styles.hintLine}>{t('fleet.docs.filesLater')}</p>
        </Card>
      )}

      {tab === 'driver' && (
        <Card className={styles.card}>
          <dl className={styles.facts}>
            <Fact label={t('fleet.col.driver')} value={driver ? `${driver.name} · ${driver.email}` : null} />
            <Fact label={t('fleet.col.department')} value={v.department} />
            <Fact label={t('fleet.col.type')} value={v.vehicle_type ? t(`fleet.type.${v.vehicle_type}` as 'fleet.type.car') : null} />
            <Fact label={t('fleet.vehicle.added')} value={formatDate(lang, new Date(v.created_at))} />
          </dl>
          {allowed('vehicles.manage') && mode === 'preview' && (
            <div className={styles.actions}>
              <Button disabled title={t('fleet.preview.notSaved')}>{t('fleet.vehicle.assign')}</Button>
              <Button disabled title={t('fleet.preview.notSaved')}>{t('fleet.vehicle.archive')}</Button>
            </div>
          )}
          {allowed('vehicles.manage') && mode === 'live' && <VehicleControls vehicle={v} onEdit={() => setEditing(true)} />}
        </Card>
      )}

      {tab === 'notes' && (
        <Card className={styles.card}>
          {issues.length === 0 ? (
            <p className={styles.note}>{t('fleet.issues.none')}</p>
          ) : (
            <ul className={styles.plainList}>
              {issues.map((i) => (
                <li key={i.id} className={styles.lineRow}>
                  <span className={styles.lineText}>
                    <span>{i.body}</span>
                    <span className={styles.muted}>
                      {t(`fleet.issue.${i.kind}`)} · {memberName(i.reported_by)} · {formatDate(lang, new Date(i.created_at))}
                    </span>
                  </span>
                  <span className={`${pill.pill} ${pill[i.status === 'open' ? 'amber' : i.status === 'scheduled' ? 'blue' : 'muted']}`}>{t(`fleet.issueStatus.${i.status}`)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );

  function historyItem(job: FleetJob) {
    const showMoney = money;
    const split = showMoney ? partsAndLabor(job) : null;
    return (
      <li key={job.id} className={styles.timelineItem}>
        <div className={styles.timelineHead}>
          <span className={styles.timelineDate}>{formatDate(lang, jobEndDay(job))}</span>
          {showMoney && job.cost !== null && <span className="mono">{formatMoney(lang, job.cost)}</span>}
        </div>
        <p className={styles.timelineTitle}>{lang === 'ro' ? job.service_name_ro : job.service_name_en}</p>
        <p className={styles.muted}>
          {job.shop_name}, {job.shop_city}
          {job.odometer !== null ? ` · ${formatKm(lang, job.odometer)}` : ''} · <span className="mono">{job.ref}</span>
        </p>
        {job.work && <p className={styles.timelineWork}>{job.work}</p>}
        {split && (
          <p className={styles.muted}>
            {t('fleet.history.split', { parts: formatMoney(lang, split.parts), labor: formatMoney(lang, split.labor) })}
          </p>
        )}
        <div className={styles.timelineTags}>
          {job.warranty_until && <span className={`${pill.pill} ${pill.green}`}>{t('fleet.history.warranty', { date: formatDate(lang, job.warranty_until) })}</span>}
          {job.quote && (
            <span className={`${pill.pill} ${pill.muted}`}>
              <FileText size={12} aria-hidden="true" /> {t('fleet.history.quote', { v: job.quote.version })}
            </span>
          )}
        </div>
      </li>
    );
  }

  function docList(list: ReturnType<typeof documentStates>) {
    return (
      <ul className={styles.plainList}>
        {CAR_DOCS.map(({ doc }) => {
          const d = list.find((x) => x.doc === doc);
          if (!d) return null;
          const tone = d.urgency === 'expired' ? 'red' : d.urgency === 'soon' ? 'amber' : d.urgency === 'missing' ? 'muted' : 'green';
          return (
            <li key={doc} className={styles.lineRow}>
              <span className={styles.lineText}>
                <span>{t(`doc.${doc}`)}</span>
                <span className={styles.muted}>{d.date ? formatDate(lang, d.date) : t('fleet.docs.missing')}</span>
              </span>
              <span className={`${pill.pill} ${pill[tone]}`}>{t(`fleet.docs.${d.urgency}`)}</span>
            </li>
          );
        })}
      </ul>
    );
  }
}

function Fact({ label, value, hint, mono }: { label: string; value: string | null; hint?: string; mono?: boolean }) {
  return (
    <div className={styles.fact}>
      <dt>{label}</dt>
      <dd className={mono && value ? 'mono' : undefined}>{value ?? <span className={styles.muted}>—</span>}</dd>
      {hint && value && <span className={styles.factHint}>{hint}</span>}
    </div>
  );
}
