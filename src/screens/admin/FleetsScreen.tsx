import { CalendarPlus, Pencil, Repeat, Truck } from 'lucide-react';
import { useCallback, useState } from 'react';
import { ActionButton } from '../../components/ActionButton';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { Field } from '../../components/Field';
import { ChoiceFilters } from '../../components/Filters';
import { LoadError } from '../../components/LoadError';
import { MoreActions } from '../../components/MoreActions';
import { PageHeader } from '../../components/PageHeader';
import { SelectField } from '../../components/SelectField';
import { SkeletonList } from '../../components/Skeleton';
import {
  adminExtendCompanyTrial,
  adminFleetPlans,
  adminListFleetCompanies,
  adminSetCompanyPlan,
  adminUpdateFleetPlan,
  type AdminFleetCompany,
} from '../../data/fleet';
import { canRetryRpc, rpcErrorMessage } from '../../data/rpc';
import { useI18n } from '../../i18n/context';
import { formatDate, formatMoney } from '../../i18n/format';
import { plural } from '../../i18n/translate';
import { planState, trialDaysLeft, type FleetPlanRow, type PlanState } from '../../lib/fleet';
import { useLoad } from '../../lib/useLoad';
import pill from '../../components/StatusBadge.module.css';
import { ADMIN_ACCOUNT_PATH } from './paths';
import styles from './admin.module.css';
import own from './fleets.module.css';

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
  const load = useCallback(async () => {
    const [companies, plans] = await Promise.all([adminListFleetCompanies(), adminFleetPlans()]);
    return { companies, plans };
  }, []);
  const { state, reload, setData } = useLoad(load);
  const [planFilter, setPlanFilter] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const refresh = useCallback(async () => setData(await load()), [load, setData]);

  let body;
  if (state.status === 'loading') body = <SkeletonList />;
  else if (state.status === 'error') body = <LoadError message={t('admin.fleets.loadError')} onRetry={reload} />;
  else {
    const { companies, plans } = state.data;
    const shown = companies.filter(
      (c) => (!planFilter || c.plan.plan_key === planFilter) && (!stateFilter || planState(c.plan) === stateFilter),
    );
    body = (
      <>
        <ChoiceFilters
          groups={[
            {
              key: 'plan',
              title: t('admin.fleets.plan'),
              options: [{ value: '', label: t('admin.fleets.anyPlan') }, ...plans.map((p) => ({ value: p.key, label: lang === 'ro' ? p.name_ro : p.name_en }))],
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
        {shown.length === 0 ? (
          <EmptyState icon={Truck} title={companies.length === 0 ? t('admin.fleets.none') : t('admin.fleets.noMatch')} />
        ) : (
          <ul className={own.list}>
            {shown.map((c) => (
              <CompanyRow key={c.id} c={c} plans={plans} onChanged={refresh} />
            ))}
          </ul>
        )}

        <section className={styles.section} aria-labelledby="admin-fleet-plans">
          <h2 id="admin-fleet-plans" className={styles.sectionTitle}>
            {t('admin.fleets.plans')}
          </h2>
          <p className={styles.muted}>{t('admin.fleets.plansNote')}</p>
          <ul className={own.planGrid}>
            {plans.map((p) => (
              <PlanRow key={p.key} p={p} onChanged={refresh} />
            ))}
          </ul>
        </section>
      </>
    );
  }

  return (
    <div className={styles.page}>
      <PageHeader back={{ to: ADMIN_ACCOUNT_PATH, label: t('nav.account') }} title={t('admin.fleets.title')} subtitle={t('admin.fleets.subtitle')} />
      {body}
    </div>
  );
}

function CompanyRow({ c, plans, onChanged }: { c: AdminFleetCompany; plans: Plan[]; onChanged: () => Promise<void> }) {
  const { t, lang } = useI18n();
  const [mode, setMode] = useState<'view' | 'plan' | 'trial'>('view');
  const [planKey, setPlanKey] = useState(c.plan.plan_key);
  const [days, setDays] = useState('30');
  const st = planState(c.plan);
  const left = trialDaysLeft(c.plan.trial_ends_at);
  const err = (e: unknown) => rpcErrorMessage(lang, e);

  return (
    <li>
      <Card className={own.row}>
        <div className={own.rowHead}>
          <div className={own.rowText}>
            <span className={own.rowName}>{c.name}</span>
            <span className={styles.muted}>{[c.admin_email, c.vat_id].filter(Boolean).join(' · ')}</span>
          </div>
          <span className={`${pill.pill} ${pill[STATE_TONE[st]]}`}>{t(`fleet.sub.state.${st}`)}</span>
        </div>
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
              {c.plan.included_members === null ? c.plan.colleagues : t('fleet.sub.colleaguesOf', { n: c.plan.colleagues, included: c.plan.included_members })}
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
        {mode === 'view' && (
          <MoreActions
            items={[
              { key: 'plan', label: t('admin.fleets.changePlan'), icon: <Repeat size={18} aria-hidden="true" />, onSelect: () => setMode('plan') },
              ...(c.plan.status === 'trial' || c.plan.status === 'inactive'
                ? [{ key: 'trial', label: t('admin.fleets.extendTrial'), icon: <CalendarPlus size={18} aria-hidden="true" />, onSelect: () => setMode('trial') }]
                : []),
            ]}
          />
        )}
        {mode === 'plan' && (
          <div className={own.panel}>
            <SelectField
              label={t('admin.fleets.plan')}
              value={planKey}
              onChange={(e) => setPlanKey(e.target.value)}
              options={plans.filter((p) => p.active).map((p) => ({ value: p.key, label: lang === 'ro' ? p.name_ro : p.name_en }))}
            />
            <div className={own.panelButtons}>
              <ActionButton
                block={false}
                disabled={planKey === c.plan.plan_key}
                errorMessage={err}
                canRetry={canRetryRpc}
                onAction={async (requestId) => {
                  await adminSetCompanyPlan(c.id, planKey, requestId);
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
            <div className={own.panelButtons}>
              <ActionButton
                block={false}
                errorMessage={err}
                canRetry={canRetryRpc}
                onAction={async (requestId) => {
                  await adminExtendCompanyTrial(c.id, Number(days), requestId);
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
      </Card>
    </li>
  );
}

function PlanRow({ p, onChanged }: { p: Plan; onChanged: () => Promise<void> }) {
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
    <li>
      <Card className={own.row}>
        <div className={own.rowHead}>
          <span className={own.rowName}>{lang === 'ro' ? p.name_ro : p.name_en}</span>
          <span className="mono">{p.price_ron === null ? t('fleet.sub.customPrice') : t('fleet.sub.perMonth', { amount: formatMoney(lang, p.price_ron) })}</span>
        </div>
        <p className={styles.muted}>
          {p.vehicle_limit === null ? t('fleet.sub.vehiclesCustom') : t('fleet.sub.vehiclesUpTo', { n: p.vehicle_limit })} ·{' '}
          {p.included_members === null
            ? t('fleet.sub.colleaguesCustom')
            : t('fleet.sub.colleaguesIncluded', { n: plural(lang, 'unit.colleagues', p.included_members) })}
          {p.included_members !== null && p.member_price_ron !== null ? ` · ${t('fleet.sub.colleaguePrice', { price: formatMoney(lang, p.member_price_ron) })}` : ''}
        </p>
        {!editing ? (
          <MoreActions items={[{ key: 'edit', label: t('admin.fleets.editPlan'), icon: <Pencil size={18} aria-hidden="true" />, onSelect: () => setEditing(true) }]} />
        ) : (
          <div className={own.panel}>
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
              <ActionButton
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
          </div>
        )}
      </Card>
    </li>
  );
}
