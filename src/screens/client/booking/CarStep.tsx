import { Car as CarIcon, Check, Plus } from 'lucide-react';
import { useState } from 'react';
import { useSession } from '../../../app/sessionContext';
import { ActionButton } from '../../../components/ActionButton';
import { Banner } from '../../../components/Banner';
import { BottomBar } from '../../../components/BottomBar';
import { Card } from '../../../components/Card';
import { Switch } from '../../../components/Switch';
import { Field } from '../../../components/Field';
import { LoadError } from '../../../components/LoadError';
import { OfferNote } from '../../../components/OfferNote';
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
import type { OfferKind } from '../../../lib/offers';
import { composeUnsureNote, unsureDescribed, type Symptom } from '../../../lib/symptoms';
import { PhoneVerify } from '../../phone/PhoneVerify';
import { ResendConfirmation } from '../../auth/ResendConfirmation';
import { SERVICE_SEPARATOR } from '../../../lib/bookingServices';
import { serviceName } from '../shop/serviceGroups';
import { SummaryRow } from './BookingSent';
import type { CarDraft } from './carDraft';
import styles from './booking.module.css';

const NOTE_MAX = 1000;
/** Room left in the note for the line of selected symptoms. */
const SYMPTOMS_LINE_MAX = 300;

/**
 * Step 4: a car from the garage in one tap, or typed in (saved to the garage unless unticked),
 * an optional note, the summary and "Trimite cererea". A client whose email is not confirmed gets
 * the explanation instead of the button (create_booking refuses them anyway). After repeated
 * no-shows the database asks for a phone confirmed by SMS (T25): the code panel opens right here.
 * The client may let the shop see what was done on the car at other shops (T27), unticked by default.
 * For a constatare tehnică the note describes the symptoms: a selected symptom or a few words are
 * needed, and the selected ones go first in the note ("Simptome semnalate: …").
 */
export function CarStep({
  shop,
  services,
  unsure,
  symptoms,
  offer,
  day,
  time,
  draft,
  onDraft,
  onSent,
  onStale,
}: {
  shop: ShopPageShop;
  services: ShopPageService[];
  /** A constatare tehnică is among the services. */
  unsure: boolean;
  symptoms: readonly Symptom[];
  /** The offer this booking should get (the larger one); the database decides when it is made. */
  offer: { percent: number; kind: OfferKind } | null;
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
  /** null, or why the phone must be confirmed first: the number of no-shows (T25). */
  const [phoneNeeded, setPhoneNeeded] = useState<number | null>(null);
  const [phoneDone, setPhoneDone] = useState(false);
  const set = (changes: Partial<CarDraft>) => onDraft({ ...draft, ...changes });

  if (state.status === 'loading') return <SkeletonList count={2} />;
  if (state.status === 'error') return <LoadError message={t('booking.car.loadError')} onRetry={reload} />;

  const cars = state.data;
  const manual = draft.manual || cars.length === 0;
  const picked = manual ? null : (cars.find((c) => c.id === draft.carId) ?? null);
  const yearProblem = manual && !isValidCarYear(draft.year) ? t('car.yearInvalid', { max: carYearMax() }) : null;
  const typedOk = draft.make.trim() !== '' && draft.model.trim() !== '' && !yearProblem;
  const described = !unsure || unsureDescribed(symptoms, draft.note);
  const ready = (manual ? typedOk : picked !== null) && described;
  const symptomNames = symptoms.map((s) => t(`booking.symptom.${s}`));
  const symptomsLine = symptomNames.length
    ? t('booking.unsure.notePrefix', { symptoms: symptomNames.map(lowerFirst).join(', ') })
    : null;
  const carText = manual ? typedCarText(draft) : picked ? carLabel(picked) : '';

  async function send(requestId: string) {
    const typedYear = draft.year.trim();
    try {
      const booking = await createBooking(
        {
          shopId: shop.id,
          serviceId: services[0]!.id,
          extraServiceIds: services.slice(1).map((x) => x.id),
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
          note: composeUnsureNote(symptomsLine, draft.note, NOTE_MAX) || undefined,
          shareHistory: draft.share,
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
      const err = toRpcError(e);
      if (err.code === 'phone_verification_required') {
        setPhoneNeeded(Number(err.params.no_shows) || 2);
        setPhoneDone(false);
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
          <Switch checked={draft.save} onChange={(e) => set({ save: e.target.checked })}>
            {t('booking.car.save')}
          </Switch>
        </Card>
      )}

      <TextArea
        label={t(unsure ? 'booking.unsure.noteLabel' : 'booking.note')}
        placeholder={t(unsure ? 'booking.unsure.notePlaceholder' : 'booking.notePlaceholder')}
        value={draft.note}
        maxLength={unsure ? NOTE_MAX - SYMPTOMS_LINE_MAX : NOTE_MAX}
        rows={3}
        onChange={(e) => set({ note: e.target.value })}
      />

      {/* T27: the client's agreement, never ticked for them. */}
      <div className={styles.share}>
        <Switch checked={draft.share} hint={t('booking.share.hint')} onChange={(e) => set({ share: e.target.checked })}>
          {t('booking.share.label')}
        </Switch>
      </div>

      <Card className={styles.summary}>
        <h2 className={styles.groupTitle}>{t('booking.summary')}</h2>
        <SummaryRow label={t('booking.summary.shop')} value={shop.name} />
        <SummaryRow
          label={t(services.length > 1 ? 'booking.summary.services' : 'booking.summary.service')}
          value={services.map((x) => serviceName(x, lang)).join(SERVICE_SEPARATOR)}
        />
        {symptomNames.length > 0 && <SummaryRow label={t('booking.summary.symptoms')} value={symptomNames.join(', ')} />}
        <SummaryRow label={t('booking.summary.when')} value={`${formatDate(lang, day)}, ${time}`} mono />
        {carText && <SummaryRow label={t('booking.summary.car')} value={carText} />}
        {offer !== null && (
          <OfferNote>{t(offer.kind === 'quiet_day' ? 'offer.quiet.booking' : 'offer.booking', { n: offer.percent })}</OfferNote>
        )}
        {shop.inspection_fee > 0 && (
          <>
            <SummaryRow label={t('shop.fee')} value={formatMoney(lang, shop.inspection_fee)} mono />
            <p className={styles.muted}>{t('shop.feeNote')}</p>
          </>
        )}
      </Card>

      {phoneNeeded !== null && (
        <Card>
          <section aria-labelledby="booking-phone-title" className={styles.stack}>
            <h2 id="booking-phone-title" className={styles.groupTitle}>
              {t('booking.phone.title')}
            </h2>
            <p className={styles.muted}>{t('booking.phone.why', { n: phoneNeeded })}</p>
            {phoneDone ? (
              <p role="status">{t('booking.phone.done')}</p>
            ) : session.profile?.phone ? (
              <PhoneVerify
                phone={session.profile.phone}
                onVerified={async () => {
                  setPhoneDone(true);
                  await session.refreshProfile();
                }}
              />
            ) : (
              <p>{t('booking.phone.missing')}</p>
            )}
          </section>
        </Card>
      )}

      {phoneNeeded !== null && !phoneDone ? null : session.emailVerified ? (
        <BottomBar>
          {manual && !typedOk && <p className={styles.muted}>{t('car.required')}</p>}
          {!described && <p className={styles.muted}>{t('booking.unsure.required')}</p>}
          {shop.auto_confirm && <p className={styles.muted}>{t('booking.instantNote')}</p>}
          <ActionButton onAction={send} disabled={!ready} errorMessage={(e) => rpcErrorMessage(lang, e)} canRetry={canRetryRpc}>
            {t(shop.auto_confirm ? 'booking.submitInstant' : 'booking.submit')}
          </ActionButton>
        </BottomBar>
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

/** "Zgomote neobișnuite" → "zgomote neobișnuite" inside the sentence. */
function lowerFirst(s: string): string {
  return s.charAt(0).toLocaleLowerCase() + s.slice(1);
}

function carLabel(c: Pick<Car, 'make' | 'model' | 'plate'>): string {
  return [`${c.make} ${c.model}`.trim(), c.plate].filter(Boolean).join(' · ');
}

function typedCarText(d: CarDraft): string {
  if (!d.make.trim() && !d.model.trim()) return '';
  return carLabel({ make: d.make.trim(), model: d.model.trim(), plate: d.plate.trim().toUpperCase() || null });
}
