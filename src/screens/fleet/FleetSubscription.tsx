import { Check, CreditCard, Lock } from 'lucide-react';
import { useCallback } from 'react';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { LoadError } from '../../components/LoadError';
import { SkeletonList } from '../../components/Skeleton';
import { useI18n } from '../../i18n/context';
import { formatDate, formatMoney } from '../../i18n/format';
import { plural } from '../../i18n/translate';
import { offeredFeatures, overLimit, planState, trialDaysLeft, trialUsed, type FleetPlanRow, type FleetSubscriptionView } from '../../lib/fleet';
import { useLoad } from '../../lib/useLoad';
import { Meter } from '../shop/reports/Charts';
import { useFleet } from './fleetContext';
import pill from '../../components/StatusBadge.module.css';
import styles from './fleet.module.css';

const STATE_TONE = { trial: 'amber', trial_over: 'muted', active: 'green', past_due: 'red', cancelled: 'muted', inactive: 'muted' } as const;

/**
 * Abonament și facturare (T64a, docs/FLEET_BILLING_PLAN.md §C.8): the plan, its price, the trial
 * days left, what the company uses against the plan's limits, and the plans side by side — only
 * features that exist. No payment yet: no pay or change buttons, one line saying so. Admin,
 * manager and accountant; a driver never gets here.
 */
export function FleetSubscription() {
  const { t } = useI18n();
  const { data, loadSubscription } = useFleet();
  const load = useCallback(() => loadSubscription(), [loadSubscription]);
  const { state, reload } = useLoad(load);

  if (data.me.role === 'driver') {
    return <EmptyState icon={Lock} title={t('fleet.sub.locked')} body={t('fleet.sub.lockedBody')} />;
  }
  if (state.status === 'loading') return <SkeletonList cards />;
  if (state.status === 'error') return <LoadError message={t('fleet.sub.loadError')} onRetry={reload} />;
  return <Subscription view={state.data} />;
}

function Subscription({ view }: { view: FleetSubscriptionView }) {
  const { t, lang } = useI18n();
  const { plan, usage, plans } = view;
  const now = new Date();
  const st = planState(plan, now);
  const days = trialDaysLeft(plan.trial_ends_at, now);
  const name = lang === 'ro' ? plan.name_ro : plan.name_en;
  const vehiclesOver = overLimit(usage.vehicles, plan.vehicle_limit);

  return (
    <div className={styles.stack}>
      <div className={styles.grid2}>
        <Card className={styles.card}>
          <div className={styles.cardHead}>
            <span className={styles.planEyebrow}>
              <CreditCard size={16} aria-hidden="true" /> {t('fleet.sub.current')}
            </span>
            <span className={`${pill.pill} ${pill[STATE_TONE[st]]}`}>{t(`fleet.sub.state.${st}`)}</span>
          </div>
          <p className={styles.planName}>{name}</p>
          <p className={styles.planPrice}>
            {plan.price_ron === null ? t('fleet.sub.customPrice') : t('fleet.sub.perMonth', { amount: formatMoney(lang, plan.price_ron) })}
          </p>
          {st === 'trial' && days !== null && plan.trial_ends_at && (
            <div className={styles.meterBlock}>
              <Meter share={trialUsed(plan.trial_started_at, plan.trial_ends_at, now)} tone={days <= 7 ? 'amber' : 'green'} />
              <p className={styles.note}>
                {t('fleet.sub.trialLeft', { days: plural(lang, 'unit.days', days), date: formatDate(lang, new Date(plan.trial_ends_at)) })}
              </p>
            </div>
          )}
          {st === 'trial_over' && <p className={styles.note}>{plan.billing_enabled ? t('fleet.sub.trialOverBilling') : t('fleet.sub.trialOver')}</p>}
          {st === 'inactive' && !plan.billing_enabled && <p className={styles.note}>{t('fleet.sub.noTrial')}</p>}
          {plan.read_only && <p className={styles.warnLine}>{t('rpcError.fleet_read_only')}</p>}
          {!plan.billing_enabled && <p className={styles.hintLine}>{t('fleet.sub.noPayments')}</p>}
        </Card>

        <Card className={styles.card}>
          <h2 className={styles.cardTitle}>{t('fleet.sub.usage')}</h2>
          {usageRow(t('fleet.sub.vehicles'), usage.vehicles, plan.vehicle_limit)}
          {usageRow(t('fleet.sub.members'), usage.members, plan.member_limit)}
          {vehiclesOver > 0 && (
            <p className={styles.warnLine}>
              {t('fleet.sub.overVehicles', { n: vehiclesOver, limit: plan.vehicle_limit ?? 0, plan: name })}
            </p>
          )}
        </Card>
      </div>

      <section className={styles.stack} aria-labelledby="fleet-plans">
        <h2 id="fleet-plans" className={styles.sectionTitle}>
          {t('fleet.sub.compare')}
        </h2>
        <ul className={styles.planGrid}>
          {plans.map((p) => (
            <PlanCard key={p.key} p={p} current={p.key === plan.plan_key} />
          ))}
        </ul>
      </section>
    </div>
  );

  function usageRow(label: string, used: number, limit: number | null) {
    const over = limit !== null && used > limit;
    return (
      <div className={styles.meterBlock}>
        <div className={styles.usageTop}>
          <span>{label}</span>
          <span className={`mono ${over ? styles.red : ''}`}>{limit === null ? t('fleet.sub.unlimitedOf', { n: used }) : t('fleet.sub.of', { n: used, limit })}</span>
        </div>
        {limit !== null && <Meter share={Math.min(1, used / limit)} tone={over ? 'red' : used / limit >= 0.8 ? 'amber' : 'green'} />}
      </div>
    );
  }
}

function PlanCard({ p, current }: { p: FleetPlanRow; current: boolean }) {
  const { t, lang } = useI18n();
  const features = offeredFeatures(p.features);
  return (
    <li className={`${styles.planCard} ${current ? styles.planCardOn : ''}`}>
      <div className={styles.cardHead}>
        <span className={styles.planCardName}>{lang === 'ro' ? p.name_ro : p.name_en}</span>
        {current && <span className={`${pill.pill} ${pill.amber}`}>{t('fleet.sub.yours')}</span>}
      </div>
      <p className={styles.planCardPrice}>
        {p.price_ron === null ? (
          t('fleet.sub.customPrice')
        ) : (
          <>
            <span className="mono">{formatMoney(lang, p.price_ron)}</span> <span className={styles.unit}>{t('fleet.sub.month')}</span>
          </>
        )}
      </p>
      <ul className={styles.planLimits}>
        <li>{p.vehicle_limit === null ? t('fleet.sub.vehiclesCustom') : t('fleet.sub.vehiclesUpTo', { n: p.vehicle_limit })}</li>
        <li>
          {p.member_limit === null
            ? t('fleet.sub.membersUnlimited')
            : p.member_limit === 1
              ? t('fleet.sub.adminOnly')
              : t('fleet.sub.membersUpTo', { n: p.member_limit })}
        </li>
      </ul>
      <ul className={styles.planFeatures}>
        {features.map((f) => (
          <li key={f}>
            <Check size={15} aria-hidden="true" className={styles.green} /> {t(`fleet.feature.${f}`)}
          </li>
        ))}
      </ul>
      {p.price_ron === null && (
        <a className={styles.planContact} href="mailto:contact@service-hub.ro">
          {t('fleet.sub.contact')}
        </a>
      )}
    </li>
  );
}
