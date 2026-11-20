import { useSession } from '../../app/sessionContext';
import { Card } from '../../components/Card';
import { useI18n } from '../../i18n/context';
import { PhoneVerify } from '../phone/PhoneVerify';
import { useIsShopOwner } from '../shop/shopRole';
import styles from './account.module.css';

/**
 * Cont, shops only (T13): while the account's phone is not confirmed, the SMS code panel. A shop
 * appears in search only with its owner's number confirmed (FR §2), so a colleague does not see it
 * (Eduard, 20 Nov 2026); nor does anyone until the account is known to be the owner's.
 */
export function PhoneCard() {
  const { t } = useI18n();
  const session = useSession();
  const isOwner = useIsShopOwner();
  const profile = session.profile;
  if (!profile || profile.role !== 'shop' || !profile.phone || !isOwner) return null;
  if (profile.phone_verified_at || profile.phone_verified_by_admin) return null;

  return (
    <Card>
      <section aria-labelledby="phone-card-title">
        <h2 id="phone-card-title" className={styles.cardTitle}>
          {t('phone.title')}
        </h2>
        <p className={styles.muted}>{t('phone.why')}</p>
        <PhoneVerify phone={profile.phone} onVerified={() => session.refreshProfile()} />
      </section>
    </Card>
  );
}
