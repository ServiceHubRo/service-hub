import { NAV } from '../../../app/roles';
import { PageHeader } from '../../../components/PageHeader';
import { Section, SectionCard } from '../../../components/Section';
import { Switch } from '../../../components/Switch';
import { updateShop } from '../../../data/shop';
import { useI18n } from '../../../i18n/context';
import { PushRow } from '../../push/PushRow';
import { SoundRow } from '../../push/SoundRow';
import { useState } from 'react';
import { SaveButton } from './SaveButton';
import { useShopSettings } from './shopSettingsContext';
import styles from './settings.module.css';

/**
 * Cont → Notificări for a shop (P5b; Eduard, 26 Oct: every notification setting in one place):
 * push and the new-booking sound on this device (T12, T47), the daily summary (a push
 * at opening time, T12) and the monthly report (email on the 1st, T24). No SMS on a new request
 * (Eduard, 4 Oct: every text costs money; the push is enough). A colleague turns push on for their
 * own phone; the summary and the report are the owner's.
 */
export function NotificationSettings() {
  const { t } = useI18n();
  const { shop, setShop, isOwner } = useShopSettings();
  const [digest, setDigest] = useState(shop.daily_digest);
  const [monthly, setMonthly] = useState(shop.monthly_report);

  async function save() {
    const saved = await updateShop(shop.id, { daily_digest: digest, monthly_report: monthly });
    setShop(saved);
    setDigest(saved.daily_digest);
    setMonthly(saved.monthly_report);
  }

  return (
    <div className={styles.page} data-layout="sections">
      <PageHeader back={{ to: NAV.shop.account.path, label: t('nav.account') }} title={t('settings.notifications')} />
      <Section title={t('notif.sec.device')} description={t('notif.sec.device.desc')}>
        <PushRow />
        <SoundRow />
      </Section>
      <Section title={t('notif.sec.summary')} description={t('notif.sec.summary.desc')}>
        {isOwner ? (
          <>
            <SectionCard>
              <Switch checked={digest} hint={t('notif.digest.hint')} onChange={(e) => setDigest(e.target.checked)}>
                {t('notif.digest')}
              </Switch>
              <Switch checked={monthly} hint={t('notif.monthly.hint')} onChange={(e) => setMonthly(e.target.checked)}>
                {t('notif.monthly')}
              </Switch>
            </SectionCard>
            <p className={styles.note}>{t('notif.soon')}</p>
          </>
        ) : (
          <p className={styles.note}>{t('settings.staff.notifications')}</p>
        )}
      </Section>
      {isOwner && <SaveButton onSave={save}>{t('notif.save')}</SaveButton>}
    </div>
  );
}
