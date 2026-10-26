import { Play, Volume2, VolumeX } from 'lucide-react';
import { useState } from 'react';
import { buttonClass } from '../../components/buttonClass';
import { Card } from '../../components/Card';
import { Switch } from '../../components/Switch';
import { useI18n } from '../../i18n/context';
import { playChime, setChimeOn, useChimeOn } from '../../lib/chime';
import styles from './push.module.css';

/**
 * The new-booking chime on this device (T47), in the shop's Notificări: on or off, and "Ascultă" to
 * hear it (which also lets the browser play it later). Saved on the device, like push.
 */
export function SoundRow() {
  const { t } = useI18n();
  const on = useChimeOn();
  const [failed, setFailed] = useState(false);

  async function listen() {
    setFailed(!(await playChime(true)));
  }

  return (
    <Card role="group" aria-label={t('notif.sound')}>
      <div className={`${styles.switchRow} ${on ? '' : styles.labelOff}`}>
        {on ? (
          <Volume2 size={20} aria-hidden="true" className={styles.switchIcon} />
        ) : (
          <VolumeX size={20} aria-hidden="true" className={styles.switchIcon} />
        )}
        <Switch
          className={styles.grow}
          checked={on}
          hint={t('notif.sound.hint')}
          onChange={(e) => {
            setChimeOn(e.target.checked);
            if (e.target.checked) void listen();
          }}
        >
          {t('notif.sound')}
        </Switch>
      </div>
      <button type="button" className={buttonClass('secondary', false, styles.listen)} onClick={() => void listen()}>
        <Play size={16} aria-hidden="true" />
        {t('notif.sound.play')}
      </button>
      {failed && (
        <p className={styles.hint} role="status">
          {t('notif.sound.failed')}
        </p>
      )}
    </Card>
  );
}
