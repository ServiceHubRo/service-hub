import { Lock } from 'lucide-react';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { useI18n } from '../../i18n/context';
import { requiredPlan, type PlanFeature } from '../../lib/fleet';
import { useFleet } from './fleetContext';
import pill from '../../components/StatusBadge.module.css';
import styles from './fleet.module.css';

/**
 * "Disponibil în Business" (T65): a discreet tag beside something the company's plan does not
 * include. The plan's name comes from the plans sold today; nothing when none includes it.
 */
export function PlanTag({ feature }: { feature: PlanFeature }) {
  const { t, lang } = useI18n();
  const { plans } = useFleet();
  const plan = requiredPlan(feature, plans);
  if (!plan) return null;
  return <span className={`${pill.pill} ${pill.amber} ${styles.planTag}`}>{t('fleet.plan.availableIn', { plan: lang === 'ro' ? plan.name_ro : plan.name_en })}</span>;
}

/**
 * A part of the page the plan does not include: what it is, in one line, the plan that has it and
 * the way to the comparison — for those who see the subscription; nobody else is shown an offer.
 * Never a fake preview of the figures.
 */
export function LockedFeature({ feature, title, body }: { feature: PlanFeature; title: string; body: string }) {
  const { t } = useI18n();
  const { go, data } = useFleet();
  return (
    <Card className={`${styles.card} ${styles.locked}`}>
      <div className={styles.lockedHead}>
        <span className={styles.lockedIcon} aria-hidden="true">
          <Lock size={16} />
        </span>
        <h2 className={styles.cardTitle}>{title}</h2>
        <PlanTag feature={feature} />
      </div>
      <p className={styles.note}>{body}</p>
      {data.me.role !== 'driver' && (
        <div>
          <Button variant="ghost" onClick={() => go({ section: 'abonament' })}>
            {t('fleet.plan.compare')}
          </Button>
        </div>
      )}
    </Card>
  );
}
