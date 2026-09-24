import { Check, ChevronRight } from 'lucide-react';
import { ServiceIcon } from '../../../components/ServiceIcon';
import type { ShopPageService } from '../../../data/search';
import { useI18n } from '../../../i18n/context';
import { groupServices, serviceName } from '../shop/serviceGroups';
import styles from './booking.module.css';

/** Step 1: only what this shop offers, under category labels. No prices — those come with the quote. */
export function ServiceStep({
  services,
  selected,
  onPick,
}: {
  services: ShopPageService[];
  selected: string | null;
  onPick: (serviceId: string) => void;
}) {
  const { t, lang } = useI18n();
  return (
    <>
      <div className={styles.groups}>
        {groupServices(services, lang).map((g) => (
          <section key={g.key} aria-label={g.name}>
            <h2 className={styles.groupTitle}>{g.name}</h2>
            <ul className={styles.options}>
              {g.items.map((s) => {
                const on = s.id === selected;
                return (
                  <li key={s.id}>
                    <button type="button" className={`${styles.option} ${on ? styles.optionOn : ''}`} aria-pressed={on} onClick={() => onPick(s.id)}>
                      <ServiceIcon name={s.icon} className={styles.optionIcon} />
                      <span className={styles.optionText}>{serviceName(s, lang)}</span>
                      {on ? <Check size={18} className={styles.check} aria-hidden="true" /> : <ChevronRight size={18} className={styles.chevron} aria-hidden="true" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      <p className={styles.muted}>{t('shop.priceNote')}</p>
    </>
  );
}
