import { Check } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { CheckMenu } from '../../../components/CheckMenu';
import { DetailPane, ListDetailLayout } from '../../../components/ListDetailLayout';
import { ListRow, ListRows } from '../../../components/ListRow';
import { StatusPill } from '../../../components/StatusPill';
import { BottomBar } from '../../../components/BottomBar';
import { SearchField } from '../../../components/SearchField';
import { ServiceIcon } from '../../../components/ServiceIcon';
import type { ShopPageService } from '../../../data/search';
import { useI18n } from '../../../i18n/context';
import { plural } from '../../../i18n/translate';
import { MAX_BOOKING_SERVICES } from '../../../lib/bookingServices';
import { toneOf } from '../../../lib/statusTone';
import { LIST_DETAIL_QUERY, useMediaQuery } from '../../../lib/useMediaQuery';
import { SYMPTOMS, UNSURE_SERVICE_ID, type Symptom } from '../../../lib/symptoms';
import { matchesWords, searchWords } from '../../../lib/text';
import { SEARCH_PATH } from '../paths';
import { groupServices, serviceName } from '../shop/serviceGroups';
import styles from './booking.module.css';
import { Button } from '../../../components/Button';

/**
 * Step 1: only what this shop offers, under category labels. No prices — those come with the quote.
 * Several services can go in the same booking (T21): each tap ticks or unticks one, up to five;
 * "Continuă" stays in sight at the bottom and names how many are picked.
 * "Constatare tehnică" (the `constatare` service, when the shop offers it) comes first, on its own;
 * ticked, it shows the symptoms the client may select. A search over the shop's services narrows the
 * list as one types, by any word of a service or of its category, in both languages (Eduard, 14 Nov
 * 2026: no scrolling through every service to find one); a ticked service stays ticked while hidden.
 */
export function ServiceStep({
  services,
  selected,
  onToggle,
  symptoms,
  onToggleSymptom,
  onContinue,
  lead,
}: {
  /** What stands above the step: the way back, the progress, the title. */
  lead: ReactNode;
  services: ShopPageService[];
  selected: readonly string[];
  onToggle: (serviceId: string) => void;
  symptoms: readonly Symptom[];
  onToggleSymptom: (s: Symptom) => void;
  onContinue: () => void;
}) {
  const { t, lang } = useI18n();
  const full = selected.length >= MAX_BOOKING_SERVICES;
  const unsure = services.find((s) => s.id === UNSURE_SERVICE_ID);
  const unsureOn = unsure ? selected.includes(unsure.id) : false;
  const [query, setQuery] = useState('');
  const words = searchWords(query);
  const others = services
    .filter((s) => s.id !== UNSURE_SERVICE_ID)
    .filter((s) => words.length === 0 || matchesWords(words, s.name_ro, s.name_en, s.category_ro, s.category_en));
  const wide = useMediaQuery(LIST_DETAIL_QUERY);
  const groups = groupServices(others, lang);
  const [categoryKey, setCategoryKey] = useState<string | null>(null);
  const active = groups.find((g) => g.key === categoryKey) ?? groups[0];

  const options = (items: ShopPageService[]) => (
    <ul className={styles.options}>
      {items.map((s) => {
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
  );
  const continueButton = (
    <>
      {full && (
        <p className={styles.muted} role="status">
          {t('booking.servicesMax')}
        </p>
      )}
      <Button variant="primary" block disabled={selected.length === 0} onClick={onContinue}>
        {selected.length === 0
          ? t('booking.servicesPick')
          : t('booking.servicesContinue', { services: plural(lang, 'unit.services', selected.length) })}
      </Button>
    </>
  );
  const controls = (
    <>
      {unsure && (
        <section aria-labelledby="unsure-title" className={styles.unsure}>
          <button
            type="button"
            className={`${styles.option} ${styles.unsureOption} ${unsureOn ? styles.optionOn : ''}`}
            aria-pressed={unsureOn}
            disabled={!unsureOn && full}
            onClick={() => onToggle(unsure.id)}
          >
            <ServiceIcon name={unsure.icon} className={styles.optionIcon} />
            <span className={styles.optionText}>
              <span id="unsure-title" className={styles.unsureTitle}>
                {t('booking.unsure.title')}
              </span>
              <span className={styles.muted}>{t('booking.unsure.text')}</span>
            </span>
            <span className={`${styles.tick} ${unsureOn ? styles.tickOn : ''}`} aria-hidden="true">
              {unsureOn && <Check size={15} strokeWidth={3} />}
            </span>
          </button>
          {unsureOn && (
            <div className={styles.symptoms}>
              <CheckMenu
                label={t('booking.unsure.symptoms')}
                summary={symptoms.length ? symptoms.map((s) => t(`booking.symptom.${s}`)).join(', ') : t('booking.unsure.symptomsNone')}
                options={SYMPTOMS.map((s) => ({ value: s, label: t(`booking.symptom.${s}`) }))}
                selected={symptoms}
                onToggle={(s) => onToggleSymptom(s as (typeof SYMPTOMS)[number])}
              />
            </div>
          )}
        </section>
      )}
      <SearchField
        id="booking-service-q"
        label={t('booking.servicesSearch')}
        placeholder={t('booking.servicesSearch')}
        value={query}
        onChange={setQuery}
        onClear={() => setQuery('')}
        clearLabel={t('search.clearQuery')}
      />
      <p className={styles.muted}>{t('booking.servicesHint')}</p>
      {others.length === 0 && words.length > 0 && (
        <p className={styles.muted} role="status">
          {t('booking.servicesSearchEmpty', { q: query.trim() })}
        </p>
      )}
    </>
  );

  // Beside the categories (a laptop, C9): the categories as rows on the left, the chosen one's services
  // on the right to tick, "Continuă" at the foot of the panel — as the shop's own services screen.
  if (wide && active) {
    return (
      <ListDetailLayout
        wide
        open={false}
        backTo={SEARCH_PATH}
        backLabel={t('nav.client.search')}
        header={
          <>
            {lead}
            {controls}
          </>
        }
        list={
          <ListRows label={t('shop.services')}>
            {groups.map((g) => {
              const picked = g.items.filter((s) => selected.includes(s.id)).length;
              return (
                <ListRow
                  key={g.key}
                  icon={<ServiceIcon name={g.items[0]?.icon} />}
                  title={g.name}
                  detail={plural(lang, 'unit.services', g.items.length)}
                  status={picked > 0 ? <StatusPill tone={toneOf('amber')}>{t('booking.pickedCount', { n: picked })}</StatusPill> : undefined}
                  selected={g.key === active.key}
                  onSelect={() => setCategoryKey(g.key)}
                />
              );
            })}
          </ListRows>
        }
        detail={
          <DetailPane
            key={active.key}
            id={active.key}
            icon={<ServiceIcon name={active.items[0]?.icon} />}
            title={active.name}
            detail={plural(lang, 'unit.services', active.items.length)}
            actions={continueButton}
          >
            {options(active.items)}
            <p className={styles.muted}>{t('shop.priceNote')}</p>
          </DetailPane>
        }
      />
    );
  }

  return (
    <>
      {lead}
      {controls}
      <div className={styles.groups}>
        {groups.map((g) => (
          <section key={g.key} aria-label={g.name}>
            <h2 className={styles.groupTitle}>{g.name}</h2>
            {options(g.items)}
          </section>
        ))}
      </div>
      <p className={styles.muted}>{t('shop.priceNote')}</p>
      <BottomBar>{continueButton}</BottomBar>
    </>
  );
}
