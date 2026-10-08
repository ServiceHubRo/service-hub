import { Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fetchPublicPricing } from '../../data/pricing';
import { useI18n } from '../../i18n/context';
import styles from './auth.module.css';

/**
 * On a new shop's sign-up form while launch places are open (Eduard, 8 Oct): the launch price next
 * to the regular one — in the city typed, once there is one (places are per city). Never how many
 * places are left. Nothing while it loads, after an error or when the city has no place left.
 */
export function LaunchOfferNote({ city }: { city: string }) {
  const { t, money } = useI18n();
  const [offer, setOffer] = useState<{ price: number; regular: number; city: string } | null>(null);
  const asked = city.trim();

  useEffect(() => {
    let alive = true;
    // A short pause while typing, so each letter is not a request.
    const id = window.setTimeout(() => {
      fetchPublicPricing(asked || undefined).then(
        (p) => {
          if (!alive) return;
          setOffer(p.launchRon !== null && p.launchRon < p.subscriptionRon ? { price: p.launchRon, regular: p.subscriptionRon, city: asked } : null);
        },
        () => undefined,
      );
    }, asked ? 400 : 0);
    return () => {
      alive = false;
      window.clearTimeout(id);
    };
  }, [asked]);

  if (!offer) return null;
  const values = { price: money(offer.price), regular: money(offer.regular), city: offer.city };
  return (
    <p className={styles.launchOffer} role="status">
      <Sparkles size={16} aria-hidden="true" />
      <span>{t(offer.city ? 'auth.launchOfferCity' : 'auth.launchOffer', values)}</span>
    </p>
  );
}
