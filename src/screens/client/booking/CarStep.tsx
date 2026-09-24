import { Car as CarIcon, Check, Plus } from 'lucide-react';
import { useState } from 'react';
import { useSession } from '../../../app/sessionContext';
import { ActionButton } from '../../../components/ActionButton';
import { Banner } from '../../../components/Banner';
import { Card } from '../../../components/Card';
import { Checkbox } from '../../../components/Checkbox';
import { Field } from '../../../components/Field';
import { LoadError } from '../../../components/LoadError';
import { SkeletonList } from '../../../components/Skeleton';
import { TextArea } from '../../../components/TextArea';
import { fetchCars, type Car } from '../../../data/garage';
import {
  canRetryRpc,
  createBooking,
  RELOAD_AVAILABILITY_CODES,
  rpcErrorMessage,
  toRpcError,
  type Booking,
} from '../../../data/rpc';
import type { ShopPageService, ShopPageShop } from '../../../data/search';
import { useI18n } from '../../../i18n/context';
import { formatDate, formatMoney } from '../../../i18n/format';
import { carYearMax, isValidCarYear } from '../../../lib/car';
import { useLoad } from '../../../lib/useLoad';
import { ResendConfirmation } from '../../auth/ResendConfirmation';
import { serviceName } from '../shop/serviceGroups';
import { SummaryRow } from './BookingSent';
import type { CarDraft } from './carDraft';
import styles from './booking.module.css';

const NOTE_MAX = 1000;

/**
 * Step 4: a car from the garage in one tap, or typed in (saved to the garage unless unticked),
 * an optional note, the summary and "Trimite cererea". A client whose email is not confirmed gets
 * the explanation instead of the button (create_booking refuses them anyway).
 */
export function CarStep({
  shop,
  service,
  day,
  time,
  draft,
  onDraft,
  onSent,
  onStale,
}: {
  shop: ShopPageShop;
  service: ShopPageService;
  day: string;
  time: string;
  draft: CarDraft;
  onDraft: (next: CarDraft) => void;
  onSent: (booking: Booking, car: string) => void;
  onStale: (message: string) => void;
}) {
  const { t, lang } = useI18n();
  const session = useSession();
  const { state, reload } = useLoad(fetchCars);
  const [yearTouched, setYearTouched] = useState(false);
  const set = (changes: Partial<CarDraft>) => onDraft({ ...draft, ...changes });

  if (state.status === 'loading') return <SkeletonList count={2} />;
  if (state.status === 'error') return <LoadError message={t('booking.car.loadError')} onRetry={reload} />;

  const cars = state.data;
  const manual = draft.manual || cars.length === 0;
  const picked = manual ? null : (cars.find((c) => c.id === draft.carId) ?? null);
  const yearProblem = manual && !isValidCarYear(draft.year) ? t('car.yearInvalid', { max: carYearMax() }) : null;
  const typedOk = draft.make.trim() !== '' && draft.model.trim() !== '' && !yearProblem;
  const ready = manual ? typedOk : picked !== null;
  const carText = manual ? typedCarText(draft) : picked ? carLabel(picked) : '';

  async function send(requestId: string) {
    const typedYear = draft.year.trim();
    try {
      const booking = await createBooking(
        {
          shopId: shop.id,
          serviceId: service.id,
          date: day,
          slot: time,
          car: manual
            ? {
                car: {
                  make: draft.make.trim(),
                  model: draft.model.trim(),
                  year: typedYear ? Number(typedYear) : null,
                  plate: draft.plate.trim().toUpperCase() || null,
                },
                saveCar: draft.save,
              }
            : { carId: picked!.id },
          note: draft.note.trim() || undefined,
        },
        requestId,
      );
      onSent(booking, carText);
    } catch (e) {
      // The day filled up or the time went while the screen was open: back to a fresh calendar.
      if (RELOAD_AVAILABILITY_CODES.has(toRpcError(e).code)) {
        onStale(rpcErrorMessage(lang, e));
        return;
      }
      throw e;
    }
  }

  return (
    <>
      {cars.length > 0 && (
        <section aria-labelledby="garage-cars">
          <h2 id="garage-cars" className={styles.groupTitle}>
            {t('booking.car.garage')}
          </h2>
          <ul className={styles.options}>
            {cars.map((c) => {
              const on = !manual && c.id === draft.carId;
              return (
                <li key={c.id}>
                  <button type="button" className={`${styles.option} ${on ? styles.optionOn : ''}`} aria-pressed={on} onClick={() => set({ carId: c.id, manual: false })}>
                    <CarIcon size={18} className={styles.optionIcon} aria-hidden="true" />
                    <span className={styles.optionText}>
                      <span className={styles.carName}>
                        {c.make} {c.model} {c.year && <span className={styles.muted}>{c.year}</span>}
                      </span>
                      {c.plate && <span className={`mono ${styles.plate}`}>{c.plate}</span>}
                    </span>
                    {on && <Check size={18} className={styles.check} aria-hidden="true" />}
                  </button>
                </li>
              );
            })}
            <li>
              <button
                type="button"
                className={`${styles.option} ${styles.dashed} ${manual ? styles.optionOn : ''}`}
                aria-pressed={manual}
                onClick={() => set({ manual: true, carId: null })}
              >
                <Plus size={18} className={styles.optionIcon} aria-hidden="true" />
                <span className={styles.optionText}>{t('booking.car.other')}</span>
                {manual && <Check size={18} className={styles.check} aria-hidden="true" />}
              </button>
            </li>
          </ul>
        </section>
      )}

      {manual && (
        <Card className={styles.form}>
          <div className={styles.pair}>
            <Field label={t('car.make')} placeholder={t('car.makePlaceholder')} value={draft.make} maxLength={60} autoComplete="off" onChange={(e) => set({ make: e.target.value })} />
            <Field label={t('car.model')} placeholder={t('car.modelPlaceholder')} value={draft.model} maxLength={60} autoComplete="off" onChange={(e) => set({ model: e.target.value })} />
          </div>
          <div className={styles.pair}>
            <Field
              label={t('car.year')}
              value={draft.year}
              inputMode="numeric"
              maxLength={4}
              mono
              autoComplete="off"
              error={yearTouched ? yearProblem : null}
              onBlur={() => setYearTouched(true)}
              onChange={(e) => set({ year: e.target.value.replace(/\D/g, '') })}
            />
            <Field
              label={t('car.plate')}
              placeholder={t('car.platePlaceholder')}
              value={draft.plate}
              maxLength={20}
              mono
              upper
              autoCapitalize="characters"
              autoComplete="off"
              onChange={(e) => set({ plate: e.target.value })}
            />
          </div>
          <Checkbox checked={draft.save} onChange={(e) => set({ save: e.target.checked })}>
            {t('booking.car.save')}
          </Checkbox>
        </Card>
      )}

      <TextArea
        label={t('booking.note')}
        placeholder={t('booking.notePlaceholder')}
        value={draft.note}
        maxLength={NOTE_MAX}
        rows={3}
        onChange={(e) => set({ note: e.target.value })}
      />

      <Card className={styles.summary}>
        <h2 className={styles.groupTitle}>{t('booking.summary')}</h2>
        <SummaryRow label={t('booking.summary.shop')} value={shop.name} />
        <SummaryRow label={t('booking.summary.service')} value={serviceName(service, lang)} />
        <SummaryRow label={t('booking.summary.when')} value={`${formatDate(lang, day)}, ${time}`} mono />
        {carText && <SummaryRow label={t('booking.summary.car')} value={carText} />}
        {shop.inspection_fee > 0 && (
          <>
            <SummaryRow label={t('shop.fee')} value={formatMoney(lang, shop.inspection_fee)} mono />
            <p className={styles.muted}>{t('shop.feeNote')}</p>
          </>
        )}
      </Card>

      {session.emailVerified ? (
        <>
          {manual && !typedOk && <p className={styles.muted}>{t('car.required')}</p>}
          <ActionButton onAction={send} disabled={!ready} errorMessage={(e) => rpcErrorMessage(lang, e)} canRetry={canRetryRpc}>
            {t('booking.submit')}
          </ActionButton>
        </>
      ) : (
        <Banner tone="warning">
          <div className={styles.stack}>
            <span>{t('booking.unverified', { email: session.user?.email ?? '' })}</span>
            {session.user?.email && <ResendConfirmation email={session.user.email} />}
          </div>
        </Banner>
      )}
    </>
  );
}

function carLabel(c: Pick<Car, 'make' | 'model' | 'plate'>): string {
  return [`${c.make} ${c.model}`.trim(), c.plate].filter(Boolean).join(' · ');
}

function typedCarText(d: CarDraft): string {
  if (!d.make.trim() && !d.model.trim()) return '';
  return carLabel({ make: d.make.trim(), model: d.model.trim(), plate: d.plate.trim().toUpperCase() || null });
}
