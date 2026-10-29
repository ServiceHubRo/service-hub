import { Camera, Trash2 } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DAMAGE_KINDS, FUEL_LEVELS, type DamageKind, type DamageMark } from '../../../../supabase/functions/_shared/carDiagram.ts';
import { damageKindText, fuelText } from '../../../../supabase/functions/_shared/jobDoc.ts';
import { ActionButton } from '../../../components/ActionButton';
import { BackLink } from '../../../components/BackLink';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { Chip, ChipRow } from '../../../components/Chip';
import { Field } from '../../../components/Field';
import { CarDiagram } from '../../../components/intake/CarDiagram';
import { IntakeView } from '../../../components/intake/IntakeView';
import { momentText } from '../../../lib/moment';
import { JobDocuments } from '../../../components/JobDocuments';
import { LoadError } from '../../../components/LoadError';
import { SelectField } from '../../../components/SelectField';
import { SkeletonList } from '../../../components/Skeleton';
import { Spinner } from '../../../components/Spinner';
import { TextArea } from '../../../components/TextArea';
import {
  fetchIntake,
  INTAKE_PHOTO_LIMIT,
  IntakePhotoError,
  intakePhotoUrls,
  removeIntakePhoto,
  saveIntake,
  uploadIntakePhoto,
  type VehicleIntake,
} from '../../../data/jobDocs';
import { canRetryRpc, rpcErrorMessage, toRpcError } from '../../../data/rpc';
import { isUnclaimedWalkIn, type ShopBooking } from '../../../data/shopBookings';
import { useI18n } from '../../../i18n/context';
import { formatKm } from '../../../i18n/format';
import { useLoad } from '../../../lib/useLoad';
import { shopBookingsLink } from '../paths';
import type { DoneState } from './ShopBookingsScreen';
import { useShopBookings } from './shopBookingsContext';
import styles from '../../../components/intake/Intake.module.css';

const ACTIVE = new Set(['confirmed', 'in_inspection', 'quote_sent', 'approved', 'in_progress']);
const NOTE_MAX = 120;
const ITEMS_MAX = 500;
const NOTES_MAX = 2000;

/**
 * Fișa de preluare (T50), written by the shop when the car comes in: odometer, fuel, the damage
 * marked on a drawing of the car (a tap adds a numbered mark, the list says what it is), photos,
 * personal items left in the car, notes and the client's two options. "Trimite clientului" saves
 * it and tells the client, who confirms it in the app; until then the shop may change it, after
 * that it stays as confirmed. The database checks every field again (`save_vehicle_intake`).
 */
export function IntakeScreen() {
  const { bookingId = '' } = useParams();
  const { t, lang } = useI18n();
  const { state: bookings, reload: reloadBookings } = useShopBookings();
  const load = useCallback(() => fetchIntake(bookingId), [bookingId]);
  const { state: intake, reload, setData } = useLoad(load);
  const back = shopBookingsLink({ tab: 'programate', booking: bookingId });

  let body;
  if (bookings.status === 'loading' || intake.status === 'loading') body = <SkeletonList count={3} />;
  else if (bookings.status === 'error') body = <LoadError message={t('sb.loadError')} onRetry={reloadBookings} />;
  else if (intake.status === 'error') body = <LoadError message={t('in.loadError')} onRetry={reload} />;
  else {
    const booking = bookings.data.bookings.find((b) => b.id === bookingId) ?? null;
    const sheet = intake.data;
    if (!booking || !ACTIVE.has(booking.status)) {
      body = sheet ? <IntakeView intake={sheet} /> : <p className={styles.muted}>{t('in.unavailable')}</p>;
    } else if (sheet?.confirmed_at) {
      body = (
        <>
          <BookingHead booking={booking} />
          <p className={styles.confirmed}>{t('in.confirmedAt', { when: momentText(lang, sheet.confirmed_at) })}</p>
          <IntakeView intake={sheet} />
          <JobDocuments bookingId={booking.id} bookingRef={booking.ref} quoteNumber={booking.quote_number} kinds={['intake']} />
        </>
      );
    } else {
      body = <IntakeForm key={sheet?.updated_at ?? 'new'} booking={booking} sheet={sheet} onSaved={setData} back={back} />;
    }
  }

  return (
    <div className={styles.page}>
      <BackLink to={back} label={t('nav.bookings')} />
      <h1>{t('in.title')}</h1>
      {body}
    </div>
  );
}

function BookingHead({ booking: b }: { booking: ShopBooking }) {
  const { t } = useI18n();
  const car = [b.car_snapshot.make, b.car_snapshot.model, b.car_snapshot.year].filter(Boolean).join(' ');
  return (
    <Card className={styles.head}>
      <p className={styles.car}>
        {car || t('sb.card.noCar')}
        {b.car_snapshot.plate && <span className="mono"> · {b.car_snapshot.plate}</span>}
      </p>
      <p className={styles.muted}>
        {b.client_name || t('sb.card.deletedClient')} · {b.ref}
      </p>
    </Card>
  );
}

type Choice = boolean | null;

function IntakeForm({
  booking,
  sheet,
  onSaved,
  back,
}: {
  booking: ShopBooking;
  sheet: VehicleIntake | null;
  onSaved: (intake: VehicleIntake) => void;
  back: string;
}) {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const { refresh } = useShopBookings();
  const [odometer, setOdometer] = useState(() => (sheet?.odometer != null ? String(sheet.odometer) : ''));
  const [fuel, setFuel] = useState<number | null>(sheet?.fuel ?? null);
  const [marks, setMarks] = useState<DamageMark[]>(() => sheet?.damages ?? []);
  const [photos, setPhotos] = useState<string[]>(() => sheet?.photos ?? []);
  const [items, setItems] = useState(sheet?.personal_items ?? '');
  const [notes, setNotes] = useState(sheet?.notes ?? '');
  const [keepParts, setKeepParts] = useState<Choice>(sheet?.keep_parts ?? null);
  const [roadTest, setRoadTest] = useState<Choice>(sheet?.road_test ?? null);
  const [odometerError, setOdometerError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(0);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const odometerRef = useRef<HTMLInputElement>(null);
  const loadUrls = useCallback(() => intakePhotoUrls(photos), [photos]);
  const { state: urls } = useLoad(loadUrls);
  const walkIn = isUnclaimedWalkIn(booking);

  function addMark(x: number, y: number) {
    setMarks((prev) => (prev.length >= 40 ? prev : [...prev, { x, y, kind: 'scratch' }]));
    // The new line of the list, so the kind can be chosen at once (without scrolling the page).
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLSelectElement>('li:last-child select')?.focus({ preventScroll: true }));
  }

  function updateMark(i: number, change: Partial<DamageMark>) {
    setMarks((prev) => prev.map((m, n) => (n === i ? { ...m, ...change } : m)));
  }

  async function addPhotos(files: FileList | null) {
    if (!files) return;
    setPhotoError(null);
    const room = INTAKE_PHOTO_LIMIT - photos.length;
    const chosen = Array.from(files).slice(0, Math.max(0, room));
    if (files.length > room) setPhotoError(t('in.photoLimit', { n: INTAKE_PHOTO_LIMIT }));
    for (const file of chosen) {
      setUploading((n) => n + 1);
      try {
        const path = await uploadIntakePhoto(booking.id, file);
        setPhotos((prev) => [...prev, path]);
      } catch (e) {
        setPhotoError(e instanceof IntakePhotoError ? t('in.photoUnreadable') : rpcErrorMessage(lang, e));
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (fileRef.current) fileRef.current.value = '';
  }

  function removePhoto(path: string) {
    setPhotos((prev) => prev.filter((p) => p !== path));
    // A file the saved sheet still lists is removed only when the change is saved.
    if (!sheet?.photos.includes(path)) void removeIntakePhoto(path);
  }

  async function submit(requestId: string) {
    const km = odometer.trim() === '' ? null : /^\d{1,7}$/.test(odometer.replace(/[\s.,]/g, '')) ? Number(odometer.replace(/[\s.,]/g, '')) : NaN;
    if (km !== null && (!Number.isFinite(km) || km > 2_000_000)) {
      setOdometerError(t('rpcError.odometer_invalid'));
      odometerRef.current?.focus();
      return;
    }
    try {
      const saved = await saveIntake(
        booking.id,
        {
          odometer: km,
          fuel,
          damages: marks.map((m) => (m.note?.trim() ? { ...m, note: m.note.trim() } : { x: m.x, y: m.y, kind: m.kind })),
          photos,
          personal_items: items.trim(),
          notes: notes.trim(),
          keep_parts: keepParts,
          road_test: roadTest,
        },
        requestId,
      );
      // Files the shop took off the sheet go once the sheet no longer lists them.
      for (const p of sheet?.photos ?? []) if (!photos.includes(p)) void removeIntakePhoto(p);
      onSaved(saved);
      refresh();
      const done: DoneState = {
        done: { key: walkIn ? 'sb.done.intake_saved' : 'sb.done.intake_sent', ref: booking.ref, date: booking.date, slot: booking.slot },
      };
      navigate(back, { replace: true, state: done });
    } catch (e) {
      const error = toRpcError(e);
      if (error.code === 'odometer_lower' || error.code === 'odometer_invalid') {
        setOdometerError(rpcErrorMessage(lang, e));
        odometerRef.current?.focus();
        return;
      }
      if (error.code === 'wrong_status' || error.code === 'intake_confirmed') refresh();
      throw e;
    }
  }

  const choice = (label: string, value: Choice, set: (v: Choice) => void) => (
    <div className={styles.choice}>
      <span className={styles.label}>{label}</span>
      <ChipRow label={label}>
        <Chip selected={value === true} onClick={() => set(value === true ? null : true)}>
          {t('common.yes')}
        </Chip>
        <Chip selected={value === false} onClick={() => set(value === false ? null : false)}>
          {t('common.no')}
        </Chip>
      </ChipRow>
    </div>
  );

  return (
    <div className={styles.form}>
      <BookingHead booking={booking} />
      {sheet && <p className={styles.muted}>{t('in.sentAt', { when: momentText(lang, sheet.updated_at) })}</p>}

      <div className={styles.row}>
        <Field
          ref={odometerRef}
          label={t('in.odometer')}
          value={odometer}
          inputMode="numeric"
          autoComplete="off"
          mono
          error={odometerError}
          hint={odometer && /^\d+$/.test(odometer) ? formatKm(lang, Number(odometer)) : undefined}
          onChange={(e) => {
            setOdometer(e.target.value);
            setOdometerError(null);
          }}
        />
        <div className={styles.choice}>
          <span className={styles.label}>{t('in.fuel')}</span>
          <ChipRow label={t('in.fuel')}>
            {FUEL_LEVELS.map((f) => (
              <Chip key={f} selected={fuel === f} onClick={() => setFuel(fuel === f ? null : f)}>
                {fuelText(lang, f)}
              </Chip>
            ))}
          </ChipRow>
        </div>
      </div>

      <section className={styles.damage} aria-labelledby="in-marks">
        <h2 id="in-marks" className={styles.heading}>
          {t('in.damage')}
        </h2>
        <p className={styles.muted}>{t('in.diagramHint')}</p>
        <div className={styles.damageBody}>
          <CarDiagram marks={marks} onAdd={addMark} label={t('in.diagramAdd')} />
          {marks.length === 0 ? (
            <p className={styles.muted}>{t('in.noDamage')}</p>
          ) : (
            <ol ref={listRef} className={styles.markEdit}>
              {marks.map((m, i) => (
                <li key={i}>
                  <span className={styles.markNo} aria-hidden="true">
                    {i + 1}
                  </span>
                  <SelectField
                    label={t('in.markKind', { n: i + 1 })}
                    value={m.kind}
                    options={DAMAGE_KINDS.map((k) => ({ value: k, label: damageKindText(lang, k) }))}
                    onChange={(e) => updateMark(i, { kind: e.target.value as DamageKind })}
                  />
                  <Field
                    label={t('in.markNote')}
                    value={m.note ?? ''}
                    maxLength={NOTE_MAX}
                    autoComplete="off"
                    onChange={(e) => updateMark(i, { note: e.target.value })}
                  />
                  <button
                    type="button"
                    className={styles.remove}
                    aria-label={t('in.markRemove', { n: i + 1 })}
                    onClick={() => setMarks((prev) => prev.filter((_, n) => n !== i))}
                  >
                    <Trash2 size={18} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>

      <section aria-labelledby="in-photos-edit" className={styles.section}>
        <h2 id="in-photos-edit" className={styles.heading}>
          {t('in.photos')}
        </h2>
        {photos.length > 0 && (
          <ul className={styles.photos}>
            {photos.map((p, i) => (
              <li key={p} className={styles.photoItem}>
                {urls.status === 'ready' && urls.data[p] ? <img src={urls.data[p]} alt="" /> : <span className={styles.photoWait} />}
                <button type="button" className={styles.photoRemove} aria-label={t('in.photoRemove', { n: i + 1 })} onClick={() => removePhoto(p)}>
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="visually-hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => void addPhotos(e.target.files)}
        />
        <div className={styles.photoActions}>
          <Button onClick={() => fileRef.current?.click()} disabled={photos.length >= INTAKE_PHOTO_LIMIT || uploading > 0}>
            {uploading > 0 ? <Spinner /> : <Camera size={18} aria-hidden="true" />}
            {uploading > 0 ? t('in.photoUploading') : t('in.photoAdd')}
          </Button>
          <span className={styles.muted}>{t('in.photoCount', { n: photos.length, max: INTAKE_PHOTO_LIMIT })}</span>
        </div>
        {photoError && (
          <p className={styles.error} role="alert">
            {photoError}
          </p>
        )}
      </section>

      <TextArea label={t('in.personal')} value={items} maxLength={ITEMS_MAX} rows={2} onChange={(e) => setItems(e.target.value)} />
      <TextArea label={t('in.notes')} value={notes} maxLength={NOTES_MAX} rows={3} onChange={(e) => setNotes(e.target.value)} />
      {choice(t('in.keepParts'), keepParts, setKeepParts)}
      {choice(t('in.roadTest'), roadTest, setRoadTest)}

      {walkIn && <p className={styles.muted}>{t('in.walkIn')}</p>}
      <div className={styles.buttons}>
        <ActionButton
          block={false}
          disabled={uploading > 0}
          onAction={submit}
          errorMessage={(e) => rpcErrorMessage(lang, e)}
          canRetry={canRetryRpc}
        >
          {walkIn ? t('in.save') : sheet ? t('in.resend') : t('in.send')}
        </ActionButton>
        <Button variant="ghost" onClick={() => navigate(back)}>
          {t('common.cancel')}
        </Button>
      </div>
      {sheet && <JobDocuments bookingId={booking.id} bookingRef={booking.ref} quoteNumber={booking.quote_number} kinds={['intake']} />}
    </div>
  );
}
