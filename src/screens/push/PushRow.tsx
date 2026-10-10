import { Bell, BellOff } from 'lucide-react';
import { ActionSwitch } from '../../components/ActionSwitch';
import { Card } from '../../components/Card';
import { disablePush, enablePush, usePushStatus } from '../../data/push';
import { rpcErrorMessage } from '../../data/rpc';
import { useI18n } from '../../i18n/context';
import { IS_NATIVE } from '../../lib/native';
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
  // In the phone app (T20b) a refusal is undone in Android's settings, not the browser's.
  if (status === 'denied') hint = t(IS_NATIVE ? 'push.hint.deniedApp' : 'push.hint.denied');
  else if (status === 'ios_install') hint = t('push.banner.ios');
  else if (status === 'unsupported') hint = t('push.hint.unsupported');

  return (
    <Card role="group" aria-label={t('push.title')}>
      <div className={`${styles.switchRow} ${blocked ? styles.labelOff : ''}`}>
        {blocked ? (
          <BellOff size={20} aria-hidden="true" className={styles.switchIcon} />
        ) : (
          <Bell size={20} aria-hidden="true" className={styles.switchIcon} />
        )}
        <ActionSwitch
          checked={on}
          disabled={!on && status !== 'prompt' && status !== 'off'}
          hint={IS_NATIVE && status === 'denied' ? t('push.status.deniedApp') : t(`push.status.${status}`)}
          onToggle={(next) => (next ? enablePush() : disablePush())}
          errorMessage={(e) => rpcErrorMessage(lang, e)}
        >
          {t('push.title')}
        </ActionSwitch>
      </div>
      <p className={styles.hint}>{hint}</p>
    </Card>
  );
}
