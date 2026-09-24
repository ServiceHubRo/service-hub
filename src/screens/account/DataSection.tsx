import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../../app/sessionContext';
import { ActionButton } from '../../components/ActionButton';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Checkbox } from '../../components/Checkbox';
import { authErrorMessage, deleteAccount, exportMyData, isRetryable } from '../../data/auth';
import { useI18n } from '../../i18n/context';
import { ymdInBucharest } from '../../i18n/format';
import styles from './account.module.css';

function download(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** "Datele mele" (P13): export as JSON, delete the account with an inline confirmation. */
export function DataSection() {
  const { t, lang } = useI18n();
  const session = useSession();
  const navigate = useNavigate();
  const profile = session.profile!;
  const [confirming, setConfirming] = useState(false);
  const [understood, setUnderstood] = useState(false);

  async function exportData() {
    const data = await exportMyData();
    download(`service-hub-${profile.display_id}-${ymdInBucharest(new Date())}.json`, data);
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
