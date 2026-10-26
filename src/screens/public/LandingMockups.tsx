import { Car, Check, Store } from 'lucide-react';
import { NAV, type Role } from '../../app/roles';
import { LogoTile } from '../../components/LogoTile';
import { Wordmark } from '../../components/Wordmark';
import { useI18n } from '../../i18n/context';
import { MOTION } from '../../lib/motion';
import landing from './Landing.module.css';
import styles from './LandingMockups.module.css';

/**
 * Above each phone of the public page, whose screen it is (T44): the driver's phone in the first
 * screen, the shop's in "Pentru service-uri", each with its own color and icon.
 */
export function ViewLabel({ role }: { role: 'client' | 'shop' }) {
  const { t } = useI18n();
  const Icon = role === 'client' ? Car : Store;
  return (
    <p className={`${styles.viewLabel} ${role === 'client' ? styles.viewDriver : styles.viewShop}`}>
      <Icon size={15} />
      {t(role === 'client' ? 'landing.view.driver' : 'landing.view.shop')}
    </p>
  );
}

/** The role's real bottom bar, first item lit: the two phones cannot be told apart by anything less. */
export function MockNav({ role }: { role: Role }) {
  const { t } = useI18n();
  return (
    <div className={styles.nav}>
      {NAV[role].bottomBar.map(({ labelKey, icon: Icon }, i) => (
        <span key={labelKey} className={i === 0 ? styles.navOn : styles.navItem}>
          <Icon size={15} />
          {t(labelKey)}
        </span>
      ))}
    </div>
  );
}

/**
 * The shop's side of the same booking (T44), decoration only, hidden from screen readers: the
 * request for Atelier Demo arrives on Panou and is confirmed, the quote (the driver's 430) is sent
 * and accepted, the car is marked ready and the client told. A 14 s loop while the page's motion
 * is on (landingMotion.ts) and MOTION.shopDemo, from the moment the phone is reached; otherwise
 * the still picture of the end.
 */
export function ShopMockup() {
  const { t, money } = useI18n();
  return (
    // A part of the page like the others (data-reveal): it comes in when reached, and only then
    // does its loop start, from the request arriving (Eduard, 25 Oct).
    <div className={landing.mockWrap} aria-hidden="true" data-reveal="">
      <div className={styles.column}>
        <ViewLabel role="shop" />
        <div className={`${landing.phone} ${styles.shopPhone}`} data-demo={MOTION.shopDemo ? '' : undefined}>
          <div className={landing.phoneBar}>
            <LogoTile size={22} />
            <Wordmark size={14} />
            <span className={styles.shopName}>{t('landing.mock.shop1')}</span>
          </div>

          <div className={styles.tiles}>
            <div className={`${styles.tile} ${styles.tileLit}`}>
              <span className={styles.swap}>
                <b className={`${styles.before} ${styles.countBefore}`}>0</b>
                <b className={styles.countAfter}>1</b>
              </span>
              <span>{t('landing.mock.newRequests')}</span>
            </div>
            <div className={styles.tile}>
              <b>3</b>
              <span>{t('landing.mock.today')}</span>
            </div>
          </div>

          <div className={`${landing.mockCard} ${landing.mockCardLit} ${styles.request}`}>
            <span className={landing.mockName}>{t('landing.mock.car')}</span>
            <span className={landing.mockMuted}>{t('landing.mock.when')}</span>
            <span className={styles.swap}>
              <span className={`${styles.before} ${styles.action} ${styles.confirmTap}`}>{t('landing.mock.confirm')}</span>
              <span className={`${styles.done} ${styles.confirmDone}`}>
                <Check size={13} />
                {t('landing.mock.confirmed')}
              </span>
            </span>
          </div>

          <div className={`${landing.mockCard} ${styles.quote}`}>
            <span className={styles.swap}>
              <span className={`${styles.before} ${landing.mockPill} ${styles.pillBefore}`}>{t('landing.mock.quoteDraft')}</span>
              <span className={`${styles.pillGreen} ${styles.pillAfter}`}>{t('landing.mock.quoteAccepted')}</span>
            </span>
            <div className={`${landing.mockLine} ${styles.line1}`}>
              <span>{t('landing.mock.pads')}</span>
              <b>{money(280)}</b>
            </div>
            <div className={`${landing.mockLine} ${styles.line2}`}>
              <span>{t('landing.mock.labor')}</span>
              <b>{money(150)}</b>
            </div>
            <div className={`${landing.mockTotal} ${styles.total}`}>
              <span>{t('landing.mock.total')}</span>
              <span>{money(430)}</span>
            </div>
            <span className={styles.swap}>
              <span className={`${styles.before} ${styles.action} ${styles.sendTap}`}>{t('landing.mock.send')}</span>
              <span className={`${styles.sent} ${styles.sendDone}`}>{t('landing.mock.sent')}</span>
            </span>
          </div>

          <span className={`${styles.ready} ${styles.readyTap}`}>{t('landing.mock.ready')}</span>

          <span className={`${styles.toast} ${styles.toastAccepted}`}>
            <Check size={14} />
            {t('landing.mock.accepted')}
          </span>
          <span className={`${styles.toast} ${styles.toastNotified}`}>
            <Check size={14} />
            {t('landing.mock.notified')}
          </span>

          <MockNav role="shop" />
        </div>
      </div>
    </div>
  );
}
