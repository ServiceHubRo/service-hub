import { Check } from 'lucide-react';
import { buttonClass } from '../../../components/buttonClass';
import { ServiceIcon } from '../../../components/ServiceIcon';
import type { ShopPageService } from '../../../data/search';
import { useI18n } from '../../../i18n/context';
import { plural } from '../../../i18n/translate';
import { MAX_BOOKING_SERVICES } from '../../../lib/bookingServices';
import { groupServices, serviceName } from '../shop/serviceGroups';
import styles from './booking.module.css';

/**
 * Step 1: only what this shop offers, under category labels. No prices — those come with the quote.
 * Several services can go in the same booking (T21): each tap ticks or unticks one, up to five;
 * "Continuă" stays in sight at the bottom and names how many are picked.
 */
export function ServiceStep({
  services,
  selected,
  onToggle,
  onContinue,
}: {
  services: ShopPageService[];
  selected: readonly string[];
  onToggle: (serviceId: string) => void;
  onContinue: () => void;
}) {
  const { t, lang } = useI18n();
  const full = selected.length >= MAX_BOOKING_SERVICES;
  return (
    <>
      <p className={styles.muted}>{t('booking.servicesHint')}</p>
      <div className={styles.groups}>
        {groupServices(services, lang).map((g) => (
          <section key={g.key} aria-label={g.name}>
            <h2 className={styles.groupTitle}>{g.name}</h2>
            <ul className={styles.options}>
              {g.items.map((s) => {
                const on = selected.includes(s.id);
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      className={`${styles.option} ${on ? styles.optionOn : ''}`}
                      aria-pressed={on}
                      disabled={!on && full}
                      onClick={() => onToggle(s.id)}
                    >
                      <ServiceIcon name={s.icon} className={styles.optionIcon} />
                      <span className={styles.optionText}>{serviceName(s, lang)}</span>
                      <span className={`${styles.tick} ${on ? styles.tickOn : ''}`} aria-hidden="true">
                        {on && <Check size={15} strokeWidth={3} />}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      <p className={styles.muted}>{t('shop.priceNote')}</p>
      <div className={styles.stickyAction}>
        {full && (
          <p className={styles.muted} role="status">
            {t('booking.servicesMax')}
          </p>
        )}
        <button type="button" className={buttonClass('primary', true)} disabled={selected.length === 0} onClick={onContinue}>
          {selected.length === 0
            ? t('booking.servicesPick')
            : t('booking.servicesContinue', { services: plural(lang, 'unit.services', selected.length) })}
        </button>
      </div>
    </>
  );
}
