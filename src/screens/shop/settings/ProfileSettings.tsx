import { ImageUp, LocateFixed, MapPin } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ActionButton } from '../../../components/ActionButton';
import { BackLink } from '../../../components/BackLink';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { Field } from '../../../components/Field';
import { TextArea } from '../../../components/TextArea';
import { rpcErrorMessage } from '../../../data/rpc';
import {
  geocodeShop,
  LOGO_MAX_BYTES,
  LOGO_TYPES,
  removeLogo,
  updateShop,
  uploadLogo,
  type GeocodeResult,
  type Shop,
} from '../../../data/shop';
import { useI18n } from '../../../i18n/context';
import type { MessageKey } from '../../../i18n/ro';
import { formatPhone, isValidPostalCode, normalizePhone } from '../../../lib/validators';
import { normalizeUrl } from '../../../lib/url';
import { SETTINGS_PATH } from './paths';
import { SaveButton } from './SaveButton';
import { ymdInBucharest } from '../../../i18n/format';
import { useShopSettings } from './shopSettingsContext';
import styles from './settings.module.css';
import own from './ProfileSettings.module.css';

interface Form {
  name: string;
  description: string;
  street: string;
  city: string;
  county: string;
  postal_code: string;
  phone: string;
  phone2: string;
  website: string;
  facebook: string;
  year: string;
}

type Errors = Partial<Record<keyof Form, string>>;

function toForm(shop: Shop): Form {
  return {
    name: shop.name,
    description: shop.description ?? '',
    street: shop.street ?? '',
    city: shop.city,
    county: shop.county ?? '',
    postal_code: shop.postal_code ?? '',
    phone: shop.phone ? formatPhone(shop.phone) : '',
    phone2: shop.phone2 ? formatPhone(shop.phone2) : '',
    website: shop.website ?? '',
    facebook: shop.facebook ?? '',
    year: shop.year_established ? String(shop.year_established) : '',
  };
}

const ADDRESS_FIELDS = ['street', 'city', 'county', 'postal_code'] as const;
const nullable = (v: string) => (v.trim() === '' ? null : v.trim());

/** Where the last map lookup left things, shown under the map status. */
type MapNote = 'searching' | 'found' | 'cityOnly' | 'notFound' | 'unavailable' | 'saved' | null;
const MAP_NOTES: Record<Exclude<MapNote, null>, MessageKey> = {
  searching: 'profile.map.searching',
  found: 'profile.map.found',
  cityOnly: 'profile.map.cityOnly',
  notFound: 'profile.map.notFound',
  unavailable: 'profile.map.unavailable',
  saved: 'profile.map.saved',
};

class GeoError extends Error {
  constructor(readonly denied: boolean) {
    super('geolocation');
  }
}

function currentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new GeoError(false));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, (e) => reject(new GeoError(e.code === e.PERMISSION_DENIED)), {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0,
    });
  });
}

/** Profil public (P5c group A + P5b identity): what clients see on the shop page. */
export function ProfileSettings() {
  const { t, lang } = useI18n();
  const { shop, setShop } = useShopSettings();
  const [form, setForm] = useState<Form>(() => toForm(shop));
  const [errors, setErrors] = useState<Errors>({});
  const [mapNote, setMapNote] = useState<MapNote>(null);
  const maxYear = Number(ymdInBucharest(new Date()).slice(0, 4));

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  }

  function validate(): Errors {
    const e: Errors = {};
    if (form.name.trim() === '') e.name = t('auth.error.shopNameRequired');
    if (form.city.trim() === '') e.city = t('auth.error.cityRequired');
    if (form.postal_code.trim() !== '' && !isValidPostalCode(form.postal_code)) e.postal_code = t('profile.error.postalCode');
    if (!normalizePhone(form.phone)) e.phone = t('auth.error.phoneInvalid');
    if (form.phone2.trim() !== '' && !normalizePhone(form.phone2)) e.phone2 = t('auth.error.phoneInvalid');
    if (form.website.trim() !== '' && !normalizeUrl(form.website)) e.website = t('profile.error.url');
    if (form.facebook.trim() !== '' && !normalizeUrl(form.facebook)) e.facebook = t('profile.error.url');
    if (form.year.trim() !== '') {
      const y = Number(form.year);
      if (!Number.isInteger(y) || y < 1900 || y > maxYear) e.year = t('profile.error.year', { max: maxYear });
    }
    return e;
  }

  async function save(): Promise<boolean> {
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length > 0) {
      focusFirstError();
      return false;
    }
    const addressChanged = ADDRESS_FIELDS.some((k) => form[k].trim() !== (shop[k] ?? '').trim());
    const saved = await updateShop(shop.id, {
      name: form.name.trim(),
      description: nullable(form.description),
      street: nullable(form.street),
      city: form.city.trim(),
      county: nullable(form.county),
      postal_code: nullable(form.postal_code.replace(/\s/g, '')),
      phone: normalizePhone(form.phone),
      phone2: form.phone2.trim() === '' ? null : normalizePhone(form.phone2),
      website: form.website.trim() === '' ? null : normalizeUrl(form.website),
      facebook: form.facebook.trim() === '' ? null : normalizeUrl(form.facebook),
      year_established: form.year.trim() === '' ? null : Number(form.year),
    });
    setShop(saved);
    setForm(toForm(saved));
    setMapNote(null);
    // The map lookup can take a few seconds: the save is done, the lookup reports on its own.
    if (addressChanged || saved.latitude === null) void locate(saved);
    return true;
  }

  async function locate(saved: Shop) {
    setMapNote('searching');
    let result: GeocodeResult;
    try {
      result = await geocodeShop();
    } catch {
      result = { unavailable: true };
    }
    if ('unavailable' in result) {
      setMapNote('unavailable');
      return;
    }
    if (!result.found) {
      setShop({ ...saved, latitude: null, longitude: null });
      setMapNote('notFound');
      return;
    }
    setShop({ ...saved, latitude: result.latitude, longitude: result.longitude });
    setMapNote(result.precision === 'address' ? 'found' : 'cityOnly');
  }

  const formRef = useRef<HTMLFormElement>(null);
  function focusFirstError() {
    requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
  }

  async function saveCurrentLocation() {
    const pos = await currentPosition();
    const saved = await updateShop(shop.id, { latitude: pos.coords.latitude, longitude: pos.coords.longitude });
    setShop(saved);
    setMapNote('saved');
  }

  const hasMap = shop.latitude !== null && shop.longitude !== null;

  return (
    <div className={styles.page}>
      <BackLink to={SETTINGS_PATH} label={t('settings.title')} />
      <h1>{t('settings.profile')}</h1>
      <p className={styles.intro}>{t('profile.intro')}</p>

      <LogoCard />

      <form ref={formRef} className={styles.stack} noValidate onSubmit={(e) => e.preventDefault()}>
        <Field
          label={t('profile.name')}
          autoComplete="organization"
          maxLength={120}
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          error={errors.name}
        />
        <TextArea
          label={t('profile.description')}
          hint={t('profile.descriptionHint')}
          maxLength={2000}
          rows={4}
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
        />

        <h2 className={styles.section}>{t('profile.address')}</h2>
        <Field
          label={t('profile.street')}
          autoComplete="street-address"
          maxLength={200}
          value={form.street}
          onChange={(e) => set('street', e.target.value)}
        />
        <div className={styles.grid2}>
          <Field
            label={t('profile.city')}
            autoComplete="address-level2"
            maxLength={80}
            value={form.city}
            onChange={(e) => set('city', e.target.value)}
            error={errors.city}
          />
          <Field
            label={t('profile.county')}
            autoComplete="address-level1"
            maxLength={80}
            value={form.county}
            onChange={(e) => set('county', e.target.value)}
          />
        </div>
        <Field
          label={t('profile.postalCode')}
          autoComplete="postal-code"
          inputMode="numeric"
          mono
          maxLength={7}
          value={form.postal_code}
          onChange={(e) => set('postal_code', e.target.value)}
          error={errors.postal_code}
        />

        <h2 className={styles.section}>{t('profile.contact')}</h2>
        <div className={styles.grid2}>
          <Field
            label={t('profile.phone')}
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            mono
            placeholder="0268 312 445"
            value={form.phone}
            onChange={(e) => set('phone', e.target.value)}
            error={errors.phone}
          />
          <Field
            label={t('profile.phone2')}
            type="tel"
            inputMode="tel"
            mono
            value={form.phone2}
            onChange={(e) => set('phone2', e.target.value)}
            error={errors.phone2}
          />
        </div>
        <Field
          label={t('profile.website')}
          type="url"
          inputMode="url"
          autoComplete="url"
          maxLength={300}
          placeholder="www.atelier.ro"
          value={form.website}
          onChange={(e) => set('website', e.target.value)}
          error={errors.website}
        />
        <Field
          label={t('profile.facebook')}
          type="url"
          inputMode="url"
          maxLength={300}
          placeholder="facebook.com/atelier"
          value={form.facebook}
          onChange={(e) => set('facebook', e.target.value)}
          error={errors.facebook}
        />
        <Field
          label={t('profile.year')}
          inputMode="numeric"
          mono
          maxLength={4}
          value={form.year}
          onChange={(e) => set('year', e.target.value.replace(/\D/g, ''))}
          error={errors.year}
        />

        <SaveButton onSave={save}>{t('profile.save')}</SaveButton>
      </form>

      <Card>
        <div className={own.mapHead}>
          <MapPin size={20} className={hasMap ? own.mapOk : own.mapMissing} aria-hidden="true" />
          <div>
            <p className={styles.cardTitle}>{t('profile.map')}</p>
            <p className={styles.note}>{t(hasMap ? 'profile.map.set' : 'profile.map.missing')}</p>
          </div>
        </div>
        {mapNote && (
          <p
            className={mapNote === 'searching' ? own.mapNote : mapNote === 'found' || mapNote === 'saved' ? own.mapNoteOk : own.mapNoteWarn}
            role="status"
          >
            {t(MAP_NOTES[mapNote])}
          </p>
        )}
        <div className={own.mapAction}>
          <ActionButton
            variant="secondary"
            onAction={saveCurrentLocation}
            canRetry={(e) => !(e instanceof GeoError && e.denied)}
            errorMessage={(e) =>
              e instanceof GeoError ? t(e.denied ? 'profile.map.denied' : 'profile.map.failed') : rpcErrorMessage(lang, e)
            }
          >
            <LocateFixed size={18} aria-hidden="true" /> {t('profile.map.useCurrent')}
          </ActionButton>
        </div>
      </Card>
    </div>
  );
}

/** Logo: pick a file, see it, then save it (the upload is a write, so it goes through ActionButton). */
function LogoCard() {
  const { t, lang } = useI18n();
  const { shop, setShop } = useShopSettings();
  const inputRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<{ file: File; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The preview's object URL is freed when it is replaced, cancelled or the screen closes.
  const pickedRef = useRef(picked);
  useEffect(() => {
    pickedRef.current = picked;
  }, [picked]);
  useEffect(() => () => {
    if (pickedRef.current) URL.revokeObjectURL(pickedRef.current.url);
  }, []);

  function pick(f: File | undefined) {
    if (inputRef.current) inputRef.current.value = '';
    if (!f) return;
    if (!(LOGO_TYPES as readonly string[]).includes(f.type)) {
      setError(t('profile.logo.wrongType'));
      return;
    }
    if (f.size > LOGO_MAX_BYTES) {
      setError(t('profile.logo.tooBig'));
      return;
    }
    setError(null);
    cancel();
    setPicked({ file: f, url: URL.createObjectURL(f) });
  }

  function cancel() {
    if (pickedRef.current) URL.revokeObjectURL(pickedRef.current.url);
    pickedRef.current = null;
    setPicked(null);
  }

  const shown = picked ? picked.url : shop.logo_url;
  const initials = shop.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

  return (
    <Card>
      <div className={own.logoRow}>
        {shown ? (
          <img src={shown} alt={t('profile.logo.alt', { name: shop.name })} className={own.logo} />
        ) : (
          <span className={own.logoEmpty} aria-hidden="true">
            {initials}
          </span>
        )}
        <div className={own.logoText}>
          <p className={styles.cardTitle}>{t('profile.logo')}</p>
          <p className={styles.note}>{t('profile.logo.hint')}</p>
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={LOGO_TYPES.join(',')}
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => pick(e.target.files?.[0])}
      />
      {error && (
        <p className={own.logoError} role="alert">
          {error}
        </p>
      )}
      <div className={`${styles.rowButtons} ${own.logoButtons}`}>
        {picked ? (
          <>
            <ActionButton
              errorMessage={(e) => rpcErrorMessage(lang, e)}
              onAction={async () => {
                setShop(await uploadLogo(shop, picked.file));
                cancel();
              }}
            >
              {t('common.save')}
            </ActionButton>
            <Button block onClick={cancel}>
              {t('common.cancel')}
            </Button>
          </>
        ) : (
          <>
            <Button block onClick={() => inputRef.current?.click()}>
              <ImageUp size={18} aria-hidden="true" /> {t(shop.logo_url ? 'profile.logo.change' : 'profile.logo.upload')}
            </Button>
            {shop.logo_url && (
              <ActionButton variant="ghost" errorMessage={(e) => rpcErrorMessage(lang, e)} onAction={async () => setShop(await removeLogo(shop))}>
                {t('profile.logo.remove')}
              </ActionButton>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
