import { useCallback, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ActionButton } from '../../../components/ActionButton';
import { BackLink } from '../../../components/BackLink';
import { Banner } from '../../../components/Banner';
import { Card } from '../../../components/Card';
import { Checkbox } from '../../../components/Checkbox';
import { Chip } from '../../../components/Chip';
import { EmptyState } from '../../../components/EmptyState';
import { Field } from '../../../components/Field';
import { LoadError } from '../../../components/LoadError';
import { SelectField } from '../../../components/SelectField';
import { SkeletonList } from '../../../components/Skeleton';
import { TextArea } from '../../../components/TextArea';
import { canRetryRpc, RELOAD_AVAILABILITY_CODES, rpcErrorMessage, toRpcError } from '../../../data/rpc';
import { fetchCatalog, fetchShopServices } from '../../../data/shop';
import { shopCreateBooking } from '../../../data/shopBookings';
import { findShopClient, type KnownClient } from '../../../data/shopImport';
import { useI18n } from '../../../i18n/context';
import type { MessageKey } from '../../../i18n/ro';
import type { Lang, Msg } from '../../../i18n/translate';
import { carYearMax, isValidCarYear } from '../../../lib/car';
import { useLoad } from '../../../lib/useLoad';
import { normalizePhone } from '../../../lib/validators';
import { CalendarPlus, FileUp } from 'lucide-react';
import { IMPORT_PATH, shopBookingsLink, SHOP_BOOKINGS_PATH } from '../paths';
import { useIsShopOwner } from '../shopRole';
import { SlotPicker } from './SlotPicker';
import { useShopBookings } from './shopBookingsContext';
import styles from './addBooking.module.css';

const NOTE_MAX = 1000;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

interface Draft {
  name: string;
  phone: string;
  email: string;
  make: string;
  model: string;
  plate: string;
  year: string;
  serviceId: string;
  note: string;
  sendInvite: boolean;
  lang: Lang;
}

type FieldName = 'name' | 'phone' | 'email' | 'car' | 'plate' | 'year' | 'service' | 'slot';

/** What is missing or wrong, the same rules as shop_create_booking. */
function problems(d: Draft, day: string | null, time: string | null): Partial<Record<FieldName, MessageKey>> {
  const p: Partial<Record<FieldName, MessageKey>> = {};
  if (!d.name.trim()) p.name = 'rpcError.client_name_required';
  if (!normalizePhone(d.phone)) p.phone = 'rpcError.phone_invalid';
  if (d.email.trim() && !EMAIL_RE.test(d.email.trim())) p.email = 'rpcError.email_invalid';
  if (!d.make.trim() || !d.model.trim()) p.car = 'wi.err.car';
  if (!d.plate.trim()) p.plate = 'rpcError.car_plate_required';
  if (!isValidCarYear(d.year)) p.year = 'car.yearInvalid';
  if (!d.serviceId) p.service = 'wi.err.service';
  if (!day || !time) p.slot = 'wi.err.slot';
  return p;
}

/** Router state Programări reads after a booking was added here. */
export interface AddedBookingState {
  added: { ref: string; date: string; slot: string; invited: boolean };
}

/**
 * "Adaugă programare" (T29): a client who called or walked in, typed in by the shop — name, phone,
 * optional email, the car, the service, the day and time from the shop's own calendar. The booking
 * starts confirmed and takes its place in the day. An SMS (and an email, when given) can carry the
 * link with which the client takes it into an account.
 */
export function AddBookingScreen() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const { state: bookings, refresh } = useShopBookings();
  const shopId = bookings.status === 'ready' ? bookings.data.shop.id : null;
  const loadServices = useCallback(async () => {
    if (!shopId) return null;
    const [catalog, offered] = await Promise.all([fetchCatalog(), fetchShopServices(shopId)]);
    const ids = new Set(offered);
    return catalog.map((c) => ({ ...c, services: c.services.filter((s) => ids.has(s.id)) })).filter((c) => c.services.length > 0);
  }, [shopId]);
  const { state, reload } = useLoad(loadServices);

  const [draft, setDraft] = useState<Draft>({
    name: '',
    phone: '',
    email: '',
    make: '',
    model: '',
    plate: '',
    year: '',
    serviceId: '',
    note: '',
    sendInvite: true,
    lang,
  });
  const [day, setDay] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [calendar, setCalendar] = useState(0);
  const [stale, setStale] = useState<Msg | null>(null);
  const [tried, setTried] = useState(false);
  const set = (changes: Partial<Draft>) => setDraft((d) => ({ ...d, ...changes }));
  const isOwner = useIsShopOwner();

  // T31a: a phone the shop already knows (imported) fills the name and offers the cars.
  const [knownFor, setKnownFor] = useState<{ phone: string; client: KnownClient } | null>(null);
  const lookedUp = useRef<string | null>(null);
  function onPhone(value: string) {
    set({ phone: value });
    const phone = normalizePhone(value);
    if (!phone || phone === lookedUp.current) return;
    lookedUp.current = phone;
    findShopClient(phone).then(
      (client) => {
        if (lookedUp.current !== phone) return;
        setKnownFor(client ? { phone, client } : null);
        if (client)
          setDraft((d) => ({
            ...d,
            name: d.name.trim() ? d.name : client.name,
            email: d.email.trim() ? d.email : (client.email ?? ''),
          }));
      },
      () => {}, // only a help: the form works the same without it
    );
  }
  const known = knownFor && normalizePhone(draft.phone) === knownFor.phone ? knownFor.client : null;

  const found = problems(draft, day, time);
  const err = (name: FieldName) => (tried && found[name] ? t(found[name]!, { max: carYearMax() }) : null);

  async function submit(requestId: string) {
    if (Object.keys(found).length > 0) {
      setTried(true);
      return;
    }
    const year = draft.year.trim();
    try {
      const row = await shopCreateBooking(
        {
          serviceId: draft.serviceId,
          date: day!,
          slot: time!,
          clientName: draft.name.trim(),
          clientPhone: draft.phone.trim(),
          clientEmail: draft.email.trim() || undefined,
          car: {
            make: draft.make.trim(),
            model: draft.model.trim(),
            plate: draft.plate.trim().toUpperCase(),
            year: year ? Number(year) : null,
          },
          note: draft.note.trim() || undefined,
          sendInvite: draft.sendInvite,
          clientLang: draft.lang,
        },
        requestId,
      );
      refresh();
      const added: AddedBookingState = {
        added: {
          ref: row.ref,
          date: row.date,
          slot: row.slot.slice(0, 5),
          invited: row.invite_sent_at !== null,
        },
      };
      navigate(shopBookingsLink({ tab: 'programate' }), { state: added });
    } catch (e) {
      // The day filled up or the time passed while the form was open: a fresh calendar.
      if (RELOAD_AVAILABILITY_CODES.has(toRpcError(e).code)) {
        setStale({ key: 'wi.stale' });
        setDay(null);
        setTime(null);
        setCalendar((n) => n + 1);
        return;
      }
      throw e;
    }
  }

  let body;
  if (bookings.status === 'loading' || state.status === 'loading' || (state.status === 'ready' && state.data === null)) {
    body = <SkeletonList count={3} />;
  } else if (bookings.status === 'error' || state.status === 'error') {
    body = <LoadError message={t('wi.loadError')} onRetry={reload} />;
  } else if (state.data!.length === 0) {
    body = <EmptyState icon={CalendarPlus} title={t('wi.noServices')} />;
  } else {
    const groups = state.data!.map((c) => ({
      label: lang === 'ro' ? c.name_ro : c.name_en,
      options: c.services.map((s) => ({
        value: s.id,
        label: lang === 'ro' ? s.name_ro : s.name_en,
      })),
    }));
    body = (
      <>
        <p className={styles.intro}>{t('wi.intro')}</p>

        <Card className={styles.section}>
          <h2 className={styles.sectionTitle}>{t('wi.client')}</h2>
          <Field
            label={t('wi.name')}
            value={draft.name}
            maxLength={120}
            autoComplete="off"
            error={err('name')}
            onChange={(e) => set({ name: e.target.value })}
          />
          <Field
            label={t('wi.phone')}
            type="tel"
            inputMode="tel"
            placeholder={t('auth.phonePlaceholder')}
            value={draft.phone}
            mono
            autoComplete="off"
            error={err('phone')}
            onChange={(e) => onPhone(e.target.value)}
          />
          {known && (
            <p className={styles.known} role="status">
              {t('imp.known')}
            </p>
          )}
          <Field
            label={t('wi.email')}
            type="email"
            inputMode="email"
            value={draft.email}
            maxLength={254}
            autoComplete="off"
            error={err('email')}
            onChange={(e) => set({ email: e.target.value })}
          />
        </Card>

        <Card className={styles.section}>
          <h2 className={styles.sectionTitle}>{t('wi.car')}</h2>
          {known && known.cars.length > 0 && (
            <div className={styles.knownCars} role="group" aria-label={t('imp.knownCars')}>
              <span className={styles.intro}>{t('imp.knownCars')}</span>
              {known.cars.map((c, i) => (
                <Chip
                  key={i}
                  selected={draft.plate.trim().toUpperCase() === (c.plate ?? '').toUpperCase() && draft.make === c.make}
                  onClick={() => set({ make: c.make, model: c.model, plate: c.plate ?? '', year: c.year ? String(c.year) : '' })}
                >
                  {[c.make, c.model, c.plate].filter(Boolean).join(' ')}
                </Chip>
              ))}
            </div>
          )}
          <div className={styles.pair}>
            <Field
              label={t('car.make')}
              placeholder={t('car.makePlaceholder')}
              value={draft.make}
              maxLength={60}
              autoComplete="off"
              error={err('car')}
              onChange={(e) => set({ make: e.target.value })}
            />
            <Field
              label={t('car.model')}
              placeholder={t('car.modelPlaceholder')}
              value={draft.model}
              maxLength={60}
              autoComplete="off"
              onChange={(e) => set({ model: e.target.value })}
            />
          </div>
          <div className={styles.pair}>
            <Field
              label={t('car.plate')}
              placeholder={t('car.platePlaceholder')}
              value={draft.plate}
              maxLength={20}
              mono
              upper
              autoCapitalize="characters"
              autoComplete="off"
              error={err('plate')}
              onChange={(e) => set({ plate: e.target.value })}
            />
            <Field
              label={t('car.year')}
              value={draft.year}
              inputMode="numeric"
              maxLength={4}
              mono
              autoComplete="off"
              error={err('year')}
              onChange={(e) => set({ year: e.target.value.replace(/\D/g, '') })}
            />
          </div>
        </Card>

        <Card className={styles.section}>
          <SelectField
            label={t('wi.service')}
            value={draft.serviceId}
            options={[{ value: '', label: t('wi.servicePick') }]}
            groups={groups}
            onChange={(e) => set({ serviceId: e.target.value })}
          />
          {err('service') && (
            <p className={styles.error} role="alert">
              {err('service')}
            </p>
          )}
        </Card>

        <Card className={styles.section}>
          <h2 className={styles.sectionTitle}>{t('wi.when')}</h2>
          {stale && <Banner tone="warning">{t(stale.key, stale.params)}</Banner>}
          <div className={styles.slots}>
            <SlotPicker
              key={calendar}
              shopId={shopId!}
              day={day}
              time={time}
              onDay={(d) => {
                setDay(d);
                setTime(null);
              }}
              onTime={setTime}
              dayLabel={t('sb.reschedule.day')}
            />
          </div>
          {err('slot') && (
            <p className={styles.error} role="alert">
              {err('slot')}
            </p>
          )}
        </Card>

        <Card className={styles.section}>
          <TextArea
            label={t('wi.note')}
            value={draft.note}
            maxLength={NOTE_MAX}
            rows={3}
            onChange={(e) => set({ note: e.target.value })}
          />
          <Checkbox checked={draft.sendInvite} onChange={(e) => set({ sendInvite: e.target.checked })}>
            {t('wi.sms')}
          </Checkbox>
          {draft.sendInvite && (
            <SelectField
              label={t('wi.lang')}
              value={draft.lang}
              options={[
                { value: 'ro', label: t('wi.lang.ro') },
                { value: 'en', label: t('wi.lang.en') },
              ]}
              onChange={(e) => set({ lang: e.target.value === 'en' ? 'en' : 'ro' })}
            />
          )}
        </Card>

        {tried && Object.keys(found).length > 0 && (
          <p className={styles.error} role="alert">
            {t('wi.err.fix')}
          </p>
        )}
        <ActionButton onAction={submit} errorMessage={(e) => rpcErrorMessage(lang, e)} canRetry={canRetryRpc}>
          {t('wi.submit')}
        </ActionButton>
      </>
    );
  }

  return (
    <div className={styles.page}>
      <BackLink to={SHOP_BOOKINGS_PATH} label={t('nav.bookings')} />
      <h1>{t('wi.title')}</h1>
      {isOwner && (
        <Link to={IMPORT_PATH} className={styles.importLink}>
          <FileUp size={16} aria-hidden="true" />
          {t('imp.link')}
        </Link>
      )}
      {body}
    </div>
  );
}
