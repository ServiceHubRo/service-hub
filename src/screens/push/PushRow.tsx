import { Bell, BellOff } from 'lucide-react';
import { ActionButton } from '../../components/ActionButton';
import { Card } from '../../components/Card';
import { disablePush, enablePush, usePushStatus } from '../../data/push';
import { rpcErrorMessage } from '../../data/rpc';
import { useI18n } from '../../i18n/context';
import styles from './push.module.css';

/**
 * "Notificări push" in Cont (both roles) and in the shop's Notificări settings (P15b): the state on
 * this device and the control. A browser that blocked them cannot show its prompt again, so the
 * row says where to allow them instead.
 */
export function PushRow() {
  const { t, lang } = useI18n();
  const status = usePushStatus();
  const on = status === 'on';
  const blocked = status === 'denied' || status === 'unsupported';

  let hint = t('push.hint');
  if (status === 'denied') hint = t('push.hint.denied');
  else if (status === 'ios_install') hint = t('push.banner.ios');
  else if (status === 'unsupported') hint = t('push.hint.unsupported');

  return (
    <Card role="group" aria-label={t('push.title')}>
      <div className={styles.row}>
        <span className={`${styles.label} ${blocked ? styles.labelOff : ''}`}>
          {blocked ? (
            <BellOff size={20} aria-hidden="true" />
          ) : (
            <Bell size={20} aria-hidden="true" />
          )}
          <span className={styles.who}>
            <span>{t('push.title')}</span>
            <span className={styles.status}>
              {t(`push.status.${status}`)}
            </span>
          </span>
        </span>
        {(status === 'prompt' || status === 'off') && (
          <ActionButton variant="secondary" block={false} onAction={enablePush} errorMessage={(e) => rpcErrorMessage(lang, e)}>
            {t('push.enable')}
          </ActionButton>
        )}
        {on && (
          <ActionButton variant="ghost" block={false} onAction={disablePush} errorMessage={(e) => rpcErrorMessage(lang, e)}>
            {t('push.disable')}
          </ActionButton>
        )}
      </div>
      <p className={styles.hint}>{hint}</p>
    </Card>
  );
}
