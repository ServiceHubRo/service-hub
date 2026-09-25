import { Store } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { BackLink } from '../../../components/BackLink';
import { Banner } from '../../../components/Banner';
import { buttonClass } from '../../../components/buttonClass';
import { EmptyState } from '../../../components/EmptyState';
import { LoadError } from '../../../components/LoadError';
import { SkeletonList } from '../../../components/Skeleton';
import { toRpcError, type Booking } from '../../../data/rpc';
import { fetchShopPage, type ShopPage } from '../../../data/search';
import { useI18n } from '../../../i18n/context';
import { formatDate } from '../../../i18n/format';
import { useLoad } from '../../../lib/useLoad';
import { bookingPath, bookingSentPath, SEARCH_PATH, shopPath } from '../paths';
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
 * The choices live in the address (`?pas=2&serviciu=ulei&zi=2026-10-14&ora=10:00`), so the phone's
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
    <div className={styles.page}>
      <BackLink to={shopPath(shopId)} label={t('booking.backToShop')} />
      <h1>{t('booking.title')}</h1>
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
  const [params] = useSearchParams();
  const { shop } = page;

  const service = page.services.find((s) => s.id === params.get('serviciu')) ?? null;
  const day = YMD.test(params.get('zi') ?? '') ? params.get('zi') : null;
  const time = HM.test(params.get('ora') ?? '') ? params.get('ora') : null;
  const asked = Math.min(Math.max(Number(params.get('pas')) || 1, 1), 4);
  const step = Math.min(asked, !service ? 1 : !day ? 2 : !time ? 3 : 4);

  /** Why the client was sent back to the days (the time went while the screen was open). */
  const [notice, setNotice] = useState<string | null>(null);
  // `?masina=<id>` (the service reminder, T19d): that garage car is picked on step 4.
  const [carDraft, setCarDraft] = useState<CarDraft>(() => ({ ...EMPTY_CAR_DRAFT, carId: params.get('masina') }));

  const urlFor = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    return `${bookingPath(shop.id)}?${next.toString()}`;
  };

  // A new step starts at the top, with the screen reader on its heading.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const shownStep = useRef(step);
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    headingRef.current?.closest('main')?.scrollTo(0, 0);
    headingRef.current?.focus({ preventScroll: true });
  }, [step]);

  function onSent(booking: Booking, car: string) {
    if (!service || !day || !time) return;
    const sent: SentState = {
      ref: booking.ref,
      shopName: shop.name,
      service: { name_ro: service.name_ro, name_en: service.name_en },
      date: day,
      time,
      car,
    };
    navigate(bookingSentPath(shop.id), { replace: true, state: sent });
  }

  function onStale(message: string) {
    setNotice(message);
    navigate(urlFor({ zi: null, ora: null, pas: '2' }));
  }

  const svc = service ? serviceName(service, lang) : '';
  const subtitle =
    step === 1
      ? shop.name
      : step === 2
        ? `${svc} · ${shop.name}`
        : step === 3
          ? `${svc} · ${formatDate(lang, day!)}`
          : `${svc} · ${formatDate(lang, day!)}, ${time}`;

  return (
    <div className={styles.page}>
      {step === 1 ? (
        <BackLink to={shopPath(shop.id)} label={t('booking.backToShop')} />
      ) : (
        <BackLink to={urlFor({ pas: String(step - 1) })} />
      )}
      <Progress step={step} />
      <div>
        <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
          {t(STEP_TITLES[step as 1 | 2 | 3 | 4])}
        </h1>
        <p className={styles.sub}>{subtitle}</p>
      </div>

      {step === 1 && (
        <ServiceStep services={page.services} selected={service?.id ?? null} onPick={(id) => navigate(urlFor({ serviciu: id, pas: '2' }))} />
      )}
      {step === 2 && (
        <DayStep
          shop={shop}
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
          shop={shop}
          service={service}
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
