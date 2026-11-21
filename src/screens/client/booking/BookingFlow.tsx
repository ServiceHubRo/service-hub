import { Store } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useLiveSearchParams } from '../../../app/useLiveSearchParams';
import { BackLink } from '../../../components/BackLink';
import { PageHeader } from '../../../components/PageHeader';
import { Banner } from '../../../components/Banner';
import { buttonClass } from '../../../components/buttonClass';
import { EmptyState } from '../../../components/EmptyState';
import { LoadError } from '../../../components/LoadError';
import { SkeletonList } from '../../../components/Skeleton';
import { toRpcError, type Booking } from '../../../data/rpc';
import { fetchShopPage, type ShopPage } from '../../../data/search';
import { useI18n } from '../../../i18n/context';
import { formatDate } from '../../../i18n/format';
import { parseServiceIds, servicesLine, toggleServiceId } from '../../../lib/bookingServices';
import { bestOffer } from '../../../lib/offers';
import { parseSymptoms, toggleSymptom, UNSURE_SERVICE_ID } from '../../../lib/symptoms';
import { useLoad } from '../../../lib/useLoad';
import { clearFleetBookingContext, fleetBookingContext } from './fleetBookingHint';
import { FleetBookingBanner } from './FleetBookingBanner';
import { bookingPath, bookingSentPath, SEARCH_PATH, shopPath, type ShopLinkState } from '../paths';
import { serviceName } from '../shop/serviceGroups';
import type { SentState } from './BookingSent';
import { EMPTY_CAR_DRAFT, type CarDraft } from './carDraft';
import { CarStep } from './CarStep';
import { DayStep } from './DayStep';
import { ServiceStep } from './ServiceStep';
import { TimeStep } from './TimeStep';
import styles from './booking.module.css';

/**
 * The booking flow (FR §3.3, P6): service → day → time → car, with a four-part progress bar.
 * The choices live in the address (`?pas=2&serviciu=ulei,frane&zi=2026-10-14&ora=10:00`; several
 * services go in one booking, T21; with a constatare tehnică also `&simptome=noise,leak`), so the phone's
 * Back goes one step back and a reload keeps them. Every rule — past times, notice, capacity,
 * limits — is checked again by create_booking when the request is sent.
 */
export function BookingFlow() {
  const { t } = useI18n();
  const { shopId = '' } = useParams();
  const load = useCallback(() => fetchShopPage(shopId), [shopId]);
  const { state, reload } = useLoad(load);

  if (state.status === 'ready' && state.data.bookable) return <Flow page={state.data} />;

  return (
    <div className={styles.page} data-fill-screen>
      <PageHeader back={{ to: shopPath(shopId), label: t('booking.backToShop') }} title={t('booking.title')} />
      {state.status === 'loading' && <SkeletonList count={3} />}
      {state.status === 'error' &&
        (toRpcError(state.error).code === 'shop_not_found' ? (
          <EmptyState
            icon={Store}
            title={t('shop.notFound')}
            body={t('shop.notFoundBody')}
            action={
              <Link to={SEARCH_PATH} className={buttonClass('primary')}>
                {t('shop.allShops')}
              </Link>
            }
          />
        ) : (
          <LoadError message={t('shop.loadError')} onRetry={reload} />
        ))}
      {state.status === 'ready' && <Banner tone="warning">{t('shop.notBookable')}</Banner>}
    </div>
  );
}

const STEP_TITLES = { 1: 'booking.step.service', 2: 'booking.step.day', 3: 'booking.step.time', 4: 'booking.step.car' } as const;

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^\d{2}:\d{2}$/;

function Flow({ page }: { page: ShopPage }) {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const [params, setParams] = useLiveSearchParams();
  const { shop } = page;
  // Opened from the search (the shop shown beside the results) or from the favorites: Back on step 1
  // returns there. Kept from the first render, because the steps change the address without it.
  const routerState = useLocation().state as ShopLinkState | null;
  const [from] = useState(routerState);

  // The services picked, in the order they were ticked; only those this shop offers.
  const serviceIds = parseServiceIds(params.get('serviciu')).filter((id) => page.services.some((s) => s.id === id));
  const services = serviceIds.map((id) => page.services.find((s) => s.id === id)!);
  const service = services[0] ?? null;
  // Constatare tehnică: the symptoms selected on step 1 (only while that service is picked).
  const unsure = serviceIds.includes(UNSURE_SERVICE_ID);
  const symptoms = unsure ? parseSymptoms(params.get('simptome')) : [];
  // Step 1 is left only with "Continuă" (`pas` above 1), not with the first tick.
  const picking = (Number(params.get('pas')) || 1) <= 1;
  const day = YMD.test(params.get('zi') ?? '') ? params.get('zi') : null;
  const time = HM.test(params.get('ora') ?? '') ? params.get('ora') : null;
  const asked = Math.min(Math.max(Number(params.get('pas')) || 1, 1), 4);
  const step = Math.min(asked, !service || picking ? 1 : !day ? 2 : !time ? 3 : 4);

  /** Why the client was sent back to the days (the time went while the screen was open). */
  const [notice, setNotice] = useState<string | null>(null);
  // `?masina=<id>` (the service reminder, T19d): that garage car is picked on step 4.
  const [carDraft, setCarDraft] = useState<CarDraft>(() => ({ ...EMPTY_CAR_DRAFT, carId: params.get('masina') }));

  const paramsWith = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    return next;
  };
  const urlFor = (changes: Record<string, string | null>) => `${bookingPath(shop.id)}?${paramsWith(changes).toString()}`;

  // A new step starts at the top, with the screen reader on its heading.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const shownStep = useRef(step);
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    window.scrollTo(0, 0);
    headingRef.current?.focus({ preventScroll: true });
  }, [step]);

  function onSent(booking: Booking, car: string, forCompany: boolean) {
    if (!service || !day || !time) return;
    // A booking for a company vehicle ends the fleet booking: the success screen leads back to the fleet.
    const fleet = forCompany ? fleetBookingContext() : null;
    clearFleetBookingContext();
    const sent: SentState = {
      ref: booking.ref,
      shopName: shop.name,
      services: services.map((x) => ({ name_ro: x.name_ro, name_en: x.name_en })),
      date: day,
      time,
      car,
      offer: booking.offer_percent,
      confirmed: booking.status === 'confirmed',
      shopId: shop.id,
      bookingId: booking.id,
      fleet: fleet ? { companyId: fleet.companyId, companyName: fleet.companyName } : undefined,
      calendar: {
        event: {
          uid: booking.id,
          title: `${svc} · ${shop.name}`,
          date: day,
          slot: time,
          minutes: shop.slot_minutes,
          location: [shop.name, shop.street, shop.city].filter(Boolean).join(', '),
          description: t('calendar.description', { ref: booking.ref }),
        },
        place: shop,
      },
    };
    navigate(bookingSentPath(shop.id), { replace: true, state: sent });
  }

  function onStale(message: string) {
    setNotice(message);
    navigate(urlFor({ zi: null, ora: null, pas: '2' }));
  }

  const svc = servicesLine(
    services.map((x) => serviceName(x, lang)),
    (first, n) => t('booking.servicesMore', { first, n }),
  );
  const subtitle =
    step === 1
      ? shop.name
      : step === 2
        ? `${svc} · ${shop.name}`
        : step === 3
          ? `${svc} · ${formatDate(lang, day!)}`
          : `${svc} · ${formatDate(lang, day!)}, ${time}`;

  const lead = (
    <>
      {step === 1 ? (
        <BackLink
          to={from?.backTo ?? shopPath(shop.id)}
          label={from?.backTo ? (from.backLabel === 'favorites' ? t('favorites.title') : t('shop.allShops')) : t('booking.backToShop')}
        />
      ) : (
        // Step 1 is the address without `pas`, as the entry before is: so Back goes back in the history
        // instead of replacing this entry (src/lib/navHistory.ts) and the way back stays whole.
        <BackLink to={urlFor({ pas: step === 2 ? null : String(step - 1) })} />
      )}
      <Progress step={step} />
      <FleetBookingBanner />
      <div data-ui="step-header">
        <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
          {t(STEP_TITLES[step as 1 | 2 | 3 | 4])}
        </h1>
        <p className={styles.sub}>{subtitle}</p>
      </div>
    </>
  );

  return (
    <div className={styles.page} data-fill-screen>
      {step !== 1 && step !== 4 && lead}

      {step === 1 && (
        <ServiceStep
          lead={lead}
          services={page.services}
          selected={serviceIds}
          // Ticks change the address in place: Back leaves step 1, not one tick.
          onToggle={(id) => {
            const next = toggleServiceId(serviceIds, id);
            const keep = next.includes(UNSURE_SERVICE_ID) ? params.get('simptome') : null;
            setParams(paramsWith({ serviciu: next.join(','), simptome: keep, pas: null }), { replace: true });
          }}
          symptoms={symptoms}
          onToggleSymptom={(s) => setParams(paramsWith({ simptome: toggleSymptom(symptoms, s).join(',') || null }), { replace: true })}
          // Come with a day and a time (a free place from search or the shop page, T28a): straight on.
          onContinue={() => navigate(urlFor({ pas: day && time ? '4' : day ? '3' : '2' }))}
        />
      )}
      {step === 2 && (
        <DayStep
          shop={shop}
          offers={page.offers}
          selected={day}
          notice={notice}
          onPick={(d) => {
            setNotice(null);
            navigate(urlFor({ zi: d, ora: d === day ? time : null, pas: '3' }));
          }}
        />
      )}
      {step === 3 && day && (
        <TimeStep shopId={shop.id} day={day} selected={time} onPick={(h) => navigate(urlFor({ ora: h, pas: '4' }))} onPickDay={() => navigate(urlFor({ pas: '2' }))} />
      )}
      {step === 4 && service && day && time && (
        <CarStep
          lead={lead}
          onChangeStep={(n) => navigate(urlFor({ pas: String(n) }))}
          shop={shop}
          services={services}
          unsure={unsure}
          symptoms={symptoms}
          offer={bestOffer(page.offers, day, serviceIds)}
          day={day}
          time={time}
          draft={carDraft}
          onDraft={setCarDraft}
          onSent={onSent}
          onStale={onStale}
        />
      )}
    </div>
  );
}

function Progress({ step }: { step: number }) {
  const { t } = useI18n();
  return (
    <div className={styles.progress}>
      <div className={styles.bars} aria-hidden="true">
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={i <= step ? styles.barOn : styles.bar} />
        ))}
      </div>
      <p className={styles.progressText}>{t('booking.progress', { step })}</p>
    </div>
  );
}
