import { Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fetchPublicPricing } from '../../data/pricing';
import { useI18n } from '../../i18n/context';
import styles from './auth.module.css';

/**
 * On a new shop's sign-up form while the launch offer is on (Eduard, 8 Oct): the launch price next
 * to the regular one, "locuri limitate". The same for every city: how many places are left, and
 * where, is the admin's business (9 Oct); the database decides at sign-up. Nothing while it loads
 * or after an error.
 */
export function LaunchOfferNote() {
  const { t, money } = useI18n();
  const [offer, setOffer] = useState<{ price: number; regular: number } | null>(null);

  useEffect(() => {
    let alive = true;
    fetchPublicPricing().then(
      (p) => {
        if (alive) setOffer(p.launchRon !== null && p.launchRon < p.subscriptionRon ? { price: p.launchRon, regular: p.subscriptionRon } : null);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, []);

  if (!offer) return null;
  return (
    <p className={styles.launchOffer} role="status">
      <Sparkles size={16} aria-hidden="true" />
      <span>{t('auth.launchOffer', { price: money(offer.price), regular: money(offer.regular) })}</span>
    </p>
  );
}
