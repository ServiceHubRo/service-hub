import { useCallback } from 'react';
import { useI18n } from '../i18n/context';
import { formatDayMonth } from '../i18n/format';
import type { MessageKey } from '../i18n/ro';
import type { NewClientOffer, OfferKind, QuietDayOffer } from './offers';

/** Monday first, as the week reads in Romania. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/**
 * The offers in words (Eduard, 8 Oct), the same on the search card, the shop page and the booking
 * steps: "-10% la manoperă la prima programare, până pe 31 oct", "-15% la manoperă lunea și marțea".
 */
export function useOfferText() {
  const { t, lang } = useI18n();

  const days = useCallback(
    (q: QuietDayOffer) =>
      new Intl.ListFormat(lang === 'ro' ? 'ro-RO' : 'en-US', { type: 'conjunction' }).format(
        WEEK_ORDER.filter((d) => q.days.includes(d)).map((d) => t(`weekday.on.${d}` as MessageKey)),
      ),
    [t, lang],
  );

  const newClientCard = useCallback(
    (o: NewClientOffer) =>
      o.until ? t('offer.cardUntil', { n: o.percent, date: formatDayMonth(lang, o.until) }) : t('offer.card', { n: o.percent }),
    [t, lang],
  );

  const newClientPage = useCallback(
    (o: NewClientOffer) =>
      o.until ? t('offer.pageUntil', { n: o.percent, date: formatDayMonth(lang, o.until) }) : t('offer.page', { n: o.percent }),
    [t, lang],
  );

  const services = useCallback(
    (o: NewClientOffer) =>
      o.services ? t('offer.services', { services: o.services.map((s) => (lang === 'ro' ? s.name_ro : s.name_en)).join(', ') }) : null,
    [t, lang],
  );

  const quietCard = useCallback((q: QuietDayOffer) => t('offer.quiet.card', { n: q.percent, days: days(q) }), [t, days]);
  const quietPage = useCallback((q: QuietDayOffer) => t('offer.quiet.page', { n: q.percent, days: days(q) }), [t, days]);

  /** The promise on a booking, from the client's side, the shop's card or the quote form. */
  const promise = useCallback(
    (side: 'client' | 'shop' | 'quote', percent: number, kind: OfferKind | string | null) => {
      const quiet = kind === 'quiet_day';
      const key = side === 'client' ? (quiet ? 'offer.quiet.client' : 'offer.client') : side === 'shop' ? (quiet ? 'offer.quiet.shop' : 'offer.shop') : quiet ? 'offer.quiet.quote' : 'offer.quote';
      return t(key, { n: percent });
    },
    [t],
  );

  return { newClientCard, newClientPage, services, quietCard, quietPage, promise };
}
