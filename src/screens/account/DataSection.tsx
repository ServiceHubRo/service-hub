import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../../app/sessionContext';
import { ActionButton } from '../../components/ActionButton';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Checkbox } from '../../components/Checkbox';
import { authErrorMessage, deleteAccount, exportMyData, isRetryable } from '../../data/auth';
import { fetchServiceNames } from '../../data/shop';
import { useI18n } from '../../i18n/context';
import { ymdInBucharest } from '../../i18n/format';
import { myDataSheets } from '../../lib/myData';
import { saveFile } from '../../lib/saveFile';
import { toXlsxBook } from '../../lib/xlsx';
import styles from './account.module.css';

/** "Datele mele" (P13): an Excel file with one sheet per kind of data; deleting the account asks first. */
export function DataSection() {
  const { t, lang } = useI18n();
  const session = useSession();
  const navigate = useNavigate();
  const profile = session.profile!;
  const [confirming, setConfirming] = useState(false);
  const [understood, setUnderstood] = useState(false);

  async function exportData() {
    // Service names make the bookings readable; without them the file still has every booking.
    const [data, services] = await Promise.all([exportMyData(), fetchServiceNames().catch(() => undefined)]);
    const file = `service-hub-${t('mydata.file')}-${profile.display_id}-${ymdInBucharest(new Date())}.xlsx`;
    await saveFile(toXlsxBook(myDataSheets(data, lang, services)), file);
  }

  async function remove() {
    await deleteAccount();
    navigate('/', { replace: true, state: { leaving: true, accountDeleted: true } });
    await session.signOut();
  }

  return (
    <>
      <h2 className={styles.section}>{t('account.data')}</h2>
      <Card>
        <div className={styles.cardStack}>
          <p className={styles.muted}>{t('account.data.rights')}</p>
          <ActionButton variant="secondary" onAction={exportData} errorMessage={(e) => authErrorMessage(lang, e)}>
            {t('account.data.export')}
          </ActionButton>
          {profile.role !== 'admin' && !confirming && (
            <Button variant="danger" block onClick={() => setConfirming(true)}>
              {t('account.delete')}
            </Button>
          )}
        </div>
      </Card>
      {profile.role !== 'admin' && confirming && (
        <Card className={styles.danger}>
          <div className={styles.cardStack}>
            <p>
              <strong>{t('account.delete.title')}</strong>
            </p>
            <p className={styles.muted}>{t(profile.role === 'shop' ? 'account.delete.bodyShop' : 'account.delete.bodyClient')}</p>
            <Checkbox checked={understood} onChange={(e) => setUnderstood(e.target.checked)}>
              {t('account.delete.understand')}
            </Checkbox>
            <div className={styles.buttons}>
              <ActionButton
                variant="danger"
                disabled={!understood}
                onAction={remove}
                errorMessage={(e) => authErrorMessage(lang, e)}
                canRetry={isRetryable}
              >
                {t('account.delete.confirm')}
              </ActionButton>
              <Button
                block
                onClick={() => {
                  setConfirming(false);
                  setUnderstood(false);
                }}
              >
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        </Card>
      )}
    </>
  );
}
