import { ChevronRight, CircleCheck, CircleDashed } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card } from '../../../components/Card';
import { SETUP_STEPS, type SetupStep, type ShopSetup } from '../../../data/shop';
import { useI18n } from '../../../i18n/context';
import type { MessageKey } from '../../../i18n/ro';
import { formatPhone } from '../../../lib/validators';
import { PhoneVerify } from '../../phone/PhoneVerify';
import { SETTINGS_LINKS } from '../settings/paths';
import styles from './Dashboard.module.css';

const STEP_LINK: Record<Exclude<SetupStep, 'phone'>, string> = {
  services: SETTINGS_LINKS.services,
  hours: SETTINGS_LINKS.hours,
  capacity: SETTINGS_LINKS.capacity,
};

/**
 * "Pune service-ul pe picioare" (P5d): four steps with "2 din 4". Shown until all four are done,
 * then never again (the database stamps setup_completed_at). Step 4 is done right here: the
 * owner asks for a code by SMS and types it (T13). The steps are the owner's: a colleague sees how
 * far it is, without links, and who does it.
 */
export function SetupChecklist({ setup, onPhoneVerified }: { setup: ShopSetup; onPhoneVerified: () => Promise<void> }) {
  const { t } = useI18n();
  const done = SETUP_STEPS.filter((s) => setup.steps[s]).length;
  const total = SETUP_STEPS.length;

  return (
    <Card highlight>
      <div className={styles.setupHead}>
        <h2 className={styles.setupTitle}>{t('dash.setup.title')}</h2>
        <span className={`mono ${styles.progressText}`}>{t('dash.setup.progress', { done, total })}</span>
      </div>
      <div
        className={styles.progress}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-valuetext={t('dash.setup.progress', { done, total })}
        aria-label={t('dash.setup.title')}
      >
        <span style={{ width: `${(done / total) * 100}%` }} />
      </div>
      {!setup.is_owner && <p className={styles.stepNote}>{t('dash.setup.staff')}</p>}
      <ol className={styles.steps}>
        {SETUP_STEPS.map((step) => {
          const ok = setup.steps[step];
          const label = t(`dash.setup.${step}` as MessageKey);
          const Icon = ok ? CircleCheck : CircleDashed;
          const content = (
            <>
              <Icon size={22} className={ok ? styles.stepDone : styles.stepTodo} aria-hidden="true" />
              <span className={styles.stepText}>
                <span className={ok ? styles.stepLabelDone : undefined}>{label}</span>
                <span className="visually-hidden"> — {t(ok ? 'dash.setup.done' : 'dash.setup.todo')}</span>
                {step === 'phone' && !ok && (!setup.owner_phone || !setup.is_owner) && (
                  <span className={styles.stepNote}>
                    {setup.owner_phone
                      ? t('dash.setup.phoneOwner', { phone: formatPhone(setup.owner_phone) })
                      : t('dash.setup.phoneMissing')}
                  </span>
                )}
              </span>
            </>
          );
          return (
            <li key={step}>
              {step === 'phone' ? (
                setup.owner_phone || ok ? (
                  <>
                    <div className={styles.step}>{content}</div>
                    {!ok && setup.is_owner && setup.owner_phone && (
                      <div className={styles.stepPanel}>
                        <PhoneVerify phone={setup.owner_phone} onVerified={onPhoneVerified} />
                      </div>
                    )}
                  </>
                ) : (
                  <Link to="/s/cont" className={styles.step}>
                    {content}
                    <ChevronRight size={18} className={styles.chevron} aria-hidden="true" />
                  </Link>
                )
              ) : setup.is_owner ? (
                <Link to={STEP_LINK[step]} className={styles.step}>
                  {content}
                  <ChevronRight size={18} className={styles.chevron} aria-hidden="true" />
                </Link>
              ) : (
                <div className={styles.step}>{content}</div>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
