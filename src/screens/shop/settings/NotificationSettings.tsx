import { BackLink } from '../../../components/BackLink';
import { Card } from '../../../components/Card';
import { Checkbox } from '../../../components/Checkbox';
import { updateShop } from '../../../data/shop';
import { useI18n } from '../../../i18n/context';
import { useState } from 'react';
import { SETTINGS_PATH } from './paths';
import { SaveButton } from './SaveButton';
import { useShopSettings } from './shopSettingsContext';
import styles from './settings.module.css';

/**
 * Notificări (P5b): SMS on a new request and the daily summary. Saved now; SMS sending starts in
 * T13 and the daily summary in T12. Phone push status and control arrive in Cont with T12.
 */
export function NotificationSettings() {
  const { t } = useI18n();
  const { shop, setShop } = useShopSettings();
  const [sms, setSms] = useState(shop.sms_on_new_booking);
  const [digest, setDigest] = useState(shop.daily_digest);

  async function save() {
    const saved = await updateShop(shop.id, { sms_on_new_booking: sms, daily_digest: digest });
    setShop(saved);
    setSms(saved.sms_on_new_booking);
    setDigest(saved.daily_digest);
  }

  return (
    <div className={styles.page}>
      <BackLink to={SETTINGS_PATH} label={t('settings.title')} />
      <h1>{t('settings.notifications')}</h1>
      <p className={styles.intro}>{t('notif.intro')}</p>
      <Card className={styles.stack}>
        <div>
          <Checkbox checked={sms} onChange={(e) => setSms(e.target.checked)} aria-describedby="notif-sms-hint">
            {t('notif.sms')}
          </Checkbox>
          <p id="notif-sms-hint" className={styles.hint}>
            {t('notif.sms.hint')}
          </p>
        </div>
        <div>
          <Checkbox checked={digest} onChange={(e) => setDigest(e.target.checked)} aria-describedby="notif-digest-hint">
            {t('notif.digest')}
          </Checkbox>
          <p id="notif-digest-hint" className={styles.hint}>
            {t('notif.digest.hint')}
          </p>
        </div>
      </Card>
      <p className={styles.note}>{t('notif.soon')}</p>
      <SaveButton onSave={save}>{t('notif.save')}</SaveButton>
    </div>
  );
}
