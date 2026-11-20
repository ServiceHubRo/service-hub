import { Repeat, Truck } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ActionButton } from '../../components/ActionButton';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { Field } from '../../components/Field';
import { ChoiceFilters } from '../../components/Filters';
import { LoadError } from '../../components/LoadError';
import { DetailPane, ListDetailLayout } from '../../components/ListDetailLayout';
import { ListRow, ListRows, ListRowsSkeleton } from '../../components/ListRow';
import { PageHeader } from '../../components/PageHeader';
import { SelectField } from '../../components/SelectField';
import {
  adminExtendCompanyTrial,
  adminFleetPlans,
  adminListFleetCompanies,
  adminSetCompanyPlan,
  adminUpdateFleetPlan,
  type AdminFleetCompany,
} from '../../data/fleet';
import { canRetryRpc, rpcErrorMessage } from '../../data/rpc';
import { adminZoneBack } from '../../app/adminZones';
import { useI18n } from '../../i18n/context';
import { formatDate, formatMoney } from '../../i18n/format';
import { plural } from '../../i18n/translate';
import { planState, trialDaysLeft, type FleetPlanRow, type PlanState } from '../../lib/fleet';
import { useListDetail } from '../../lib/useListDetail';
import { useLoad } from '../../lib/useLoad';
import { useReason } from './useReason';
import { ADMIN_FLEETS_PATH } from './paths';
import styles from './admin.module.css';
import own from './fleets.module.css';
import { StatusPill } from '../../components/StatusPill';
import { toneOf } from '../../lib/statusTone';

/** „‹ Înapoi” goes to the screen's zone (A1). */
const ZONE_BACK = adminZoneBack(ADMIN_FLEETS_PATH);

type Plan = FleetPlanRow & { position: number; public: boolean; active: boolean };
const STATE_TONE: Record<PlanState, string> = { trial: 'amber', trial_over: 'muted', active: 'green', past_due: 'red', cancelled: 'muted', inactive: 'muted' };
const STATES: readonly PlanState[] = ['trial', 'trial_over', 'active', 'past_due', 'cancelled', 'inactive'];

/**
 * Flote (T64a, platform admin): every company with its plan, state, trial end and use; the plans'
 * prices and limits. Changing a company's plan or extending its trial, and editing a plan, are
 * database functions that need the second sign-in step and write the admin log. No payments yet.
 */
export function FleetsScreen() {
  const { t, lang } = useI18n();
  const { pathname } = useLocation();
  const load = useCallback(async () => {
    const [companies, plans] = await Promise.all([adminListFleetCompanies(), adminFleetPlans()]);
    return { companies, plans };
  }, []);
  const { state, reload, setData } = useLoad(load);
  const [planFilter, setPlanFilter] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const refresh = useCallback(async () => setData(await load()), [load, setData]);

  const data = state.status === 'ready' ? state.data : null;
  const shown = data
    ? data.companies.filter((c) => (!planFilter || c.plan.plan_key === planFilter) && (!stateFilter || planState(c.plan) === stateFilter))
    : [];
  // Page template A (docs/MODEL_DE_FOLOSIRE.md P8): a row per company and one per plan; the chosen one
  // beside the list from 1024 px (in its place below).
  const { wide, selectedId, open, select } = useListDetail(
    [...shown.map((c) => `c:${c.id}`), ...(data ? data.plans.map((p) => `p:${p.key}`) : [])],
    'flota',
  );
  const company = data ? shown.find((c) => `c:${c.id}` === selectedId) ?? null : null;
  const plan = data ? data.plans.find((p) => `p:${p.key}` === selectedId) ?? null : null;

  const header = (
    <>
      <PageHeader back={{ to: ZONE_BACK.to, label: t(ZONE_BACK.label) }} title={t('admin.fleets.title')} subtitle={t('admin.fleets.subtitle')} />
      {data && (
        <ChoiceFilters
          groups={[
            {
              key: 'plan',
              title: t('admin.fleets.plan'),
              options: [{ value: '', label: t('admin.fleets.anyPlan') }, ...data.plans.map((p) => ({ value: p.key, label: lang === 'ro' ? p.name_ro : p.name_en }))],
              value: planFilter,
              defaultValue: '',
              onChange: setPlanFilter,
            },
            {
              key: 'state',
              title: t('admin.fleets.state'),
              options: [{ value: '', label: t('admin.fleets.anyState') }, ...STATES.map((s) => ({ value: s, label: t(`fleet.sub.state.${s}`) }))],
              value: stateFilter,
              defaultValue: '',
              onChange: setStateFilter,
            },
          ]}
          onClearAll={() => {
            setPlanFilter('');
            setStateFilter('');
          }}
          doneLabel={t('fleet.filters.show', { n: shown.length })}
        />
      )}
    </>
  );

  let list;
  if (state.status === 'loading') list = <ListRowsSkeleton label={t('common.loading')} />;
  else if (state.status === 'error') list = <LoadError message={t('admin.fleets.loadError')} onRetry={reload} />;
  else if (data)
    list = (
      <>
        {shown.length === 0 ? (
          <EmptyState icon={Truck} title={data.companies.length === 0 ? t('admin.fleets.none') : t('admin.fleets.noMatch')} />
        ) : (
          <ListRows label={t('admin.fleets.title')}>
            {shown.map((c) => {
              const st = planState(c.plan);
              return (
                <ListRow
                  key={c.id}
                  icon={<Truck size={20} />}
                  title={c.name}
                  detail={[c.admin_email, c.vat_id, lang === 'ro' ? c.plan.name_ro : c.plan.name_en].filter(Boolean).join(' · ')}
                  status={<StatusPill tone={toneOf(STATE_TONE[st])}>{t(`fleet.sub.state.${st}`)}</StatusPill>}
                  selected={wide && selectedId === `c:${c.id}`}
                  onSelect={() => select(`c:${c.id}`)}
                />
              );
            })}
          </ListRows>
        )}

        <section className={styles.section} aria-labelledby="admin-fleet-plans">
          <h2 id="admin-fleet-plans" className={styles.sectionTitle}>
            {t('admin.fleets.plans')}
          </h2>
          <p className={styles.muted}>{t('admin.fleets.plansNote')}</p>
          <ListRows label={t('admin.fleets.plans')}>
            {data.plans.map((p) => (
              <ListRow
                key={p.key}
                icon={<Repeat size={20} />}
                title={lang === 'ro' ? p.name_ro : p.name_en}
                detail={p.price_ron === null ? t('fleet.sub.customPrice') : t('fleet.sub.perMonth', { amount: formatMoney(lang, p.price_ron) })}
                selected={wide && selectedId === `p:${p.key}`}
                onSelect={() => select(`p:${p.key}`)}
              />
            ))}
          </ListRows>
        </section>
      </>
    );

  return (
    <div className={styles.page}>
      <ListDetailLayout
        wide={wide}
        open={open}
        backTo={pathname}
        backLabel={t('admin.fleets.title')}
        header={header}
        list={list}
        detail={
          data &&
          (company ? (
            <CompanyDetail key={company.id} c={company} plans={data.plans} onChanged={refresh} />
          ) : plan ? (
            <PlanDetail key={plan.key} p={plan} onChanged={refresh} />
          ) : null)
        }
      />
    </div>
  );
}

function CompanyDetail({ c, plans, onChanged }: { c: AdminFleetCompany; plans: Plan[]; onChanged: () => Promise<void> }) {
  const { t, lang } = useI18n();
  const [mode, setMode] = useState<'view' | 'plan' | 'trial'>('view');
  const [planKey, setPlanKey] = useState(c.plan.plan_key);
  const [days, setDays] = useState('30');
  const planReason = useReason();
  const trialReason = useReason();
  const st = planState(c.plan);
  const left = trialDaysLeft(c.plan.trial_ends_at);
  const err = (e: unknown) => rpcErrorMessage(lang, e);

  return (
    <DetailPane
      id={c.id}
      icon={<Truck size={20} />}
      title={c.name}
      detail={[c.admin_email, c.vat_id].filter(Boolean).join(' · ')}
      status={<StatusPill tone={toneOf(STATE_TONE[st])}>{t(`fleet.sub.state.${st}`)}</StatusPill>}
      actions={
        mode === 'view' ? (
          <>
            <Button variant="secondary" onClick={() => setMode('plan')}>
              {t('admin.fleets.changePlan')}
            </Button>
            {(c.plan.status === 'trial' || c.plan.status === 'inactive') && (
              <Button variant="secondary" onClick={() => setMode('trial')}>
                {t('admin.fleets.extendTrial')}
              </Button>
            )}
          </>
        ) : undefined
      }
    >
        <dl className={own.facts}>
          <div>
            <dt>{t('admin.fleets.plan')}</dt>
            <dd>{lang === 'ro' ? c.plan.name_ro : c.plan.name_en}</dd>
          </div>
          <div>
            <dt>{t('fleet.sub.vehicles')}</dt>
            <dd className="mono">{c.plan.vehicle_limit === null ? c.vehicles : `${c.vehicles} / ${c.plan.vehicle_limit}`}</dd>
          </div>
          <div>
            <dt>{t('fleet.sub.colleagues')}</dt>
            <dd className="mono">
              {c.plan.included_members === null ? c.plan.colleagues : t(c.plan.included_members === 1 ? 'fleet.sub.colleaguesOfOne' : 'fleet.sub.colleaguesOf', { n: c.plan.colleagues, included: c.plan.included_members })}
            </dd>
          </div>
          <div>
            <dt>{t('fleet.sub.totalMonth')}</dt>
            <dd className="mono">{c.plan.monthly_total === null ? t('fleet.sub.customPrice') : formatMoney(lang, c.plan.monthly_total)}</dd>
          </div>
          <div>
            <dt>{t('admin.fleets.trialEnds')}</dt>
            <dd>
              {c.plan.trial_ends_at ? formatDate(lang, new Date(c.plan.trial_ends_at)) : '—'}
              {st === 'trial' && left !== null ? <span className={styles.muted}> · {plural(lang, 'unit.days', left)}</span> : null}
            </dd>
          </div>
        </dl>
        {mode === 'plan' && (
          <div className={own.panel}>
            <SelectField
              label={t('admin.fleets.plan')}
              value={planKey}
              onChange={(e) => setPlanKey(e.target.value)}
              options={plans.filter((p) => p.active).map((p) => ({ value: p.key, label: lang === 'ro' ? p.name_ro : p.name_en }))}
            />
            {planReason.field}
            <div className={own.panelButtons}>
              <ActionButton
                block={false}
                disabled={planKey === c.plan.plan_key}
                errorMessage={err}
                canRetry={canRetryRpc}
                onAction={async (requestId) => {
                  const why = planReason.take();
                  if (!why) return;
                  await adminSetCompanyPlan(c.id, planKey, why, requestId);
                  await onChanged();
                  setMode('view');
                }}
              >
                {t('common.save')}
              </ActionButton>
              <Button onClick={() => setMode('view')}>{t('common.cancel')}</Button>
            </div>
          </div>
        )}
        {mode === 'trial' && (
          <div className={own.panel}>
            <SelectField
              label={t('admin.fleets.extendBy')}
              value={days}
              onChange={(e) => setDays(e.target.value)}
              options={['7', '14', '30', '60', '90'].map((d) => ({ value: d, label: plural(lang, 'unit.days', Number(d)) }))}
            />
            {trialReason.field}
            <div className={own.panelButtons}>
              <ActionButton
                block={false}
                errorMessage={err}
                canRetry={canRetryRpc}
                onAction={async (requestId) => {
                  const why = trialReason.take();
                  if (!why) return;
                  await adminExtendCompanyTrial(c.id, Number(days), why, requestId);
                  await onChanged();
                  setMode('view');
                }}
              >
                {t('admin.fleets.extendTrial')}
              </ActionButton>
              <Button onClick={() => setMode('view')}>{t('common.cancel')}</Button>
            </div>
          </div>
        )}
    </DetailPane>
  );
}

function PlanDetail({ p, onChanged }: { p: Plan; onChanged: () => Promise<void> }) {
  const { t, lang } = useI18n();
  const [editing, setEditing] = useState(false);
  const text = (n: number | null) => (n === null ? '' : String(n));
  const [price, setPrice] = useState(text(p.price_ron));
  const [vehicles, setVehicles] = useState(text(p.vehicle_limit));
  const [included, setIncluded] = useState(text(p.included_members));
  const [memberPrice, setMemberPrice] = useState(text(p.member_price_ron));
  const [error, setError] = useState<string | null>(null);
  const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));

  return (
    <DetailPane
      id={p.key}
      icon={<Repeat size={20} />}
      title={lang === 'ro' ? p.name_ro : p.name_en}
      detail={p.price_ron === null ? t('fleet.sub.customPrice') : t('fleet.sub.perMonth', { amount: formatMoney(lang, p.price_ron) })}
      actions={
        !editing ? (
          <Button variant="secondary" onClick={() => setEditing(true)}>
            {t('admin.fleets.editPlan')}
          </Button>
        ) : undefined
      }
    >
        <p className={styles.muted}>
          {p.vehicle_limit === null ? t('fleet.sub.vehiclesCustom') : t('fleet.sub.vehiclesUpTo', { n: p.vehicle_limit })} ·{' '}
          {p.included_members === null
            ? t('fleet.sub.colleaguesCustom')
            : t(p.included_members === 1 ? 'fleet.sub.colleaguesIncludedOne' : 'fleet.sub.colleaguesIncluded', { n: plural(lang, 'unit.colleagues', p.included_members) })}
          {p.included_members !== null && p.member_price_ron !== null ? ` · ${t('fleet.sub.colleaguePrice', { price: formatMoney(lang, p.member_price_ron) })}` : ''}
        </p>
        {editing && (
          <form className={own.panel} onSubmit={(e) => e.preventDefault()} noValidate>
            <div className={own.fields}>
              <Field label={t('admin.fleets.price')} hint={t('admin.fleets.emptyCustom')} inputMode="decimal" mono value={price} onChange={(e) => setPrice(e.target.value)} />
              <Field label={t('admin.fleets.vehicleLimit')} hint={t('admin.fleets.emptyNone')} inputMode="numeric" mono value={vehicles} onChange={(e) => setVehicles(e.target.value)} />
              <Field label={t('admin.fleets.included')} hint={t('admin.fleets.emptyCustom')} inputMode="numeric" mono value={included} onChange={(e) => setIncluded(e.target.value)} />
              <Field label={t('admin.fleets.memberPrice')} hint={t('admin.fleets.emptyCustom')} inputMode="decimal" mono value={memberPrice} onChange={(e) => setMemberPrice(e.target.value)} />
            </div>
            {error && (
              <p className={styles.warning} role="alert">
                {error}
              </p>
            )}
            <div className={own.panelButtons}>
              <ActionButton submit
                block={false}
                errorMessage={(e) => rpcErrorMessage(lang, e)}
                canRetry={canRetryRpc}
                onAction={async (requestId) => {
                  const values = [num(price), num(vehicles), num(included), num(memberPrice)];
                  if (
                    values.some((v) => v != null && (!Number.isFinite(v) || v < 0)) ||
                    (values[1] != null && (!Number.isInteger(values[1]) || values[1] < 1)) ||
                    (values[2] != null && !Number.isInteger(values[2]))
                  ) {
                    setError(t('admin.fleets.planInvalid'));
                    return;
                  }
                  await adminUpdateFleetPlan(
                    p.key,
                    { price: values[0] ?? null, vehicleLimit: values[1] ?? null, includedMembers: values[2] ?? null, memberPrice: values[3] ?? null },
                    requestId,
                  );
                  await onChanged();
                  setEditing(false);
                }}
              >
                {t('common.save')}
              </ActionButton>
              <Button onClick={() => setEditing(false)}>{t('common.cancel')}</Button>
            </div>
          </form>
        )}
    </DetailPane>
  );
}
