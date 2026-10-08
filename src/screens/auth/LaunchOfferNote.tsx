import { Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fetchPublicPricing } from '../../data/pricing';
import { useI18n } from '../../i18n/context';
import styles from './auth.module.css';

/**
 * On a new shop's sign-up form while launch places are left (Eduard, 8 Oct): the launch price next
 * to the regular one. Nothing while it loads, after an error or once the places are gone.
 */
export function LaunchOfferNote() {
  const { t, money } = useI18n();
  const [offer, setOffer] = useState<{ price: number; regular: number } | null>(null);

  useEffect(() => {
    let alive = true;
    fetchPublicPricing().then(
      (p) => {
        if (alive && p.launchRon !== null && p.launchRon < p.subscriptionRon) {
          setOffer({ price: p.launchRon, regular: p.subscriptionRon });
        }
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, []);

  if (!offer) return null;
  return (
    <p className={styles.launchOffer}>
      <Sparkles size={16} aria-hidden="true" />
      <span>{t('auth.launchOffer', { price: money(offer.price), regular: money(offer.regular) })}</span>
    </p>
  );
}
