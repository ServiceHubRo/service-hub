import { NAV } from '../../../app/roles';
import { BackLink } from '../../../components/BackLink';
import { Card } from '../../../components/Card';
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
    <div className={styles.page}>
      <BackLink to={NAV.shop.account.path} label={t('nav.account')} />
      <h1>{t('settings.notifications')}</h1>
      <div className={styles.page} data-layout="columns">
        <PushRow />
        <SoundRow />
        {isOwner && (
          <Card className={styles.stack}>
            <Switch checked={digest} hint={t('notif.digest.hint')} onChange={(e) => setDigest(e.target.checked)}>
              {t('notif.digest')}
            </Switch>
            <Switch checked={monthly} hint={t('notif.monthly.hint')} onChange={(e) => setMonthly(e.target.checked)}>
              {t('notif.monthly')}
            </Switch>
          </Card>
        )}
      </div>
      {isOwner ? (
        <>
          <p className={styles.note}>{t('notif.soon')}</p>
          <SaveButton onSave={save}>{t('notif.save')}</SaveButton>
        </>
      ) : (
        <p className={styles.note}>{t('settings.staff.notifications')}</p>
      )}
    </div>
  );
}
