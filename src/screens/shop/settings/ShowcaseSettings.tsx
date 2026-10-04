import { ArrowLeft, ArrowRight, ImagePlus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ActionButton } from '../../../components/ActionButton';
import { BackLink } from '../../../components/BackLink';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { Checkbox } from '../../../components/Checkbox';
import { LoadError } from '../../../components/LoadError';
import { SkeletonList } from '../../../components/Skeleton';
import { rpcErrorMessage } from '../../../data/rpc';
import { updateShop } from '../../../data/shop';
import {
  addShopPhoto,
  fetchShopPhotos,
  PHOTO_LIMIT,
  PHOTO_MAX_INPUT_BYTES,
  PHOTO_TYPES,
  PhotoReadError,
  removeShopPhoto,
  saveShopPhotoOrder,
  type ShopPhoto,
} from '../../../data/shopPhotos';
import { useI18n } from '../../../i18n/context';
import type { MessageKey } from '../../../i18n/ro';
import { AMENITIES, AMENITY_ICONS, isAmenity, type Amenity } from '../../../lib/amenities';
import { SETTINGS_PATH } from './paths';
import { SaveButton } from './SaveButton';
import { useShopSettings } from './shopSettingsContext';
import styles from './settings.module.css';
import own from './ShowcaseSettings.module.css';

/**
 * Poze și facilități (T28b): up to 10 photos of the workshop, in the order clients see them on the
 * shop page, and the facilities clients can filter by in search.
 */
export function ShowcaseSettings() {
  const { t } = useI18n();
  return (
    <div className={styles.page}>
      <BackLink to={SETTINGS_PATH} label={t('settings.title')} />
      <h1>{t('settings.showcase')}</h1>
      <p className={styles.intro}>{t('showcase.intro')}</p>
      <PhotosCard />
      <AmenitiesCard />
    </div>
  );
}

function PhotosCard() {
  const { t, lang } = useI18n();
  const { shop } = useShopSettings();
  const inputRef = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<ShopPhoto[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchShopPhotos(shop.id).then(
      (rows) => !cancelled && setPhotos(rows),
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
    };
  }, [shop.id, attempt]);

  /** The files picked, checked one by one; the ones that fit are uploaded in order. */
  async function addFiles(files: File[]) {
    if (!photos) return;
    const room = PHOTO_LIMIT - photos.length;
    const usable = files.filter((f) => (PHOTO_TYPES as readonly string[]).includes(f.type) && f.size <= PHOTO_MAX_INPUT_BYTES);
    const skipped = files.length - usable.length + Math.max(0, usable.length - room);
    let list = photos;
    for (const f of usable.slice(0, room)) {
      const added = await addShopPhoto(shop.id, f, list.length === 0 ? 0 : Math.max(...list.map((p) => p.position)) + 1);
      list = [...list, added];
      setPhotos(list);
    }
    setNotice(skipped > 0 ? t('showcase.photos.skipped', { n: skipped }) : null);
  }

  async function move(id: string, by: -1 | 1) {
    if (!photos) return;
    const i = photos.findIndex((p) => p.id === id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= photos.length) return;
    const next = [...photos];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setPhotos(await saveShopPhotoOrder(next));
  }

  const [pending, setPending] = useState<File[] | null>(null);

  return (
    <Card className={styles.stack}>
      <div>
        <p className={styles.cardTitle}>{t('showcase.photos')}</p>
        <p className={styles.hint}>{t('showcase.photos.hint', { n: PHOTO_LIMIT })}</p>
      </div>
      {failed && <LoadError message={t('showcase.photos.loadError')} onRetry={() => {
            setFailed(false);
            setAttempt((a) => a + 1);
          }} />}
      {!failed && !photos && <SkeletonList count={1} />}
      {photos && (
        <>
          <p className={styles.note} role="status">
            {t('showcase.photos.count', { n: photos.length, max: PHOTO_LIMIT })}
          </p>
          {photos.length > 0 && (
            <ul className={own.grid}>
              {photos.map((p, i) => (
                <li key={p.id} className={own.item}>
                  <img src={p.url} alt={t('showcase.photos.alt', { n: i + 1 })} className={own.photo} loading="lazy" />
                  {confirmId === p.id ? (
                    <div className={own.confirm}>
                      <p>{t('showcase.photos.removeAsk')}</p>
                      <div className={own.buttons}>
                        <ActionButton
                          variant="danger"
                          errorMessage={(e) => rpcErrorMessage(lang, e)}
                          onAction={async () => {
                            await removeShopPhoto(p);
                            setConfirmId(null);
                            setPhotos(await saveShopPhotoOrder(photos.filter((x) => x.id !== p.id)));
                          }}
                        >
                          {t('showcase.photos.removeYes')}
                        </ActionButton>
                        <Button onClick={() => setConfirmId(null)}>{t('common.cancel')}</Button>
                      </div>
                    </div>
                  ) : (
                    <div className={own.buttons}>
                      <ActionButton
                        variant="secondary"
                        disabled={i === 0}
                        errorMessage={(e) => rpcErrorMessage(lang, e)}
                        onAction={() => move(p.id, -1)}
                      >
                        <ArrowLeft size={16} aria-hidden="true" />
                        <span className="visually-hidden">{t('showcase.photos.left', { n: i + 1 })}</span>
                      </ActionButton>
                      <ActionButton
                        variant="secondary"
                        disabled={i === photos.length - 1}
                        errorMessage={(e) => rpcErrorMessage(lang, e)}
                        onAction={() => move(p.id, 1)}
                      >
                        <ArrowRight size={16} aria-hidden="true" />
                        <span className="visually-hidden">{t('showcase.photos.right', { n: i + 1 })}</span>
                      </ActionButton>
                      <Button variant="ghost" aria-label={t('showcase.photos.remove', { n: i + 1 })} onClick={() => setConfirmId(p.id)}>
                        <Trash2 size={16} aria-hidden="true" />
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <input
            ref={inputRef}
            type="file"
            accept={PHOTO_TYPES.join(',')}
            multiple
            className="visually-hidden"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = '';
              if (files.length > 0) setPending(files);
            }}
          />
          {notice && (
            <p className={styles.warn} role="status">
              {notice}
            </p>
          )}
          {pending ? (
            <div className={own.buttons}>
              <ActionButton
                errorMessage={(e) => (e instanceof PhotoReadError ? t('showcase.photos.unreadable') : rpcErrorMessage(lang, e))}
                onAction={async () => {
                  await addFiles(pending);
                  setPending(null);
                }}
              >
                {t('showcase.photos.upload', { n: pending.length })}
              </ActionButton>
              <Button onClick={() => setPending(null)}>{t('common.cancel')}</Button>
            </div>
          ) : (
            photos.length < PHOTO_LIMIT && (
              <Button onClick={() => inputRef.current?.click()}>
                <ImagePlus size={18} aria-hidden="true" /> {t('showcase.photos.add')}
              </Button>
            )
          )}
        </>
      )}
    </Card>
  );
}

function AmenitiesCard() {
  const { t } = useI18n();
  const { shop, setShop } = useShopSettings();
  const [picked, setPicked] = useState<Amenity[]>(() => (shop.amenities ?? []).filter(isAmenity));

  function toggle(a: Amenity, on: boolean) {
    setPicked((list) => (on ? AMENITIES.filter((x) => x === a || list.includes(x)) : list.filter((x) => x !== a)));
  }

  async function save(): Promise<boolean> {
    const saved = await updateShop(shop.id, { amenities: picked });
    setShop(saved);
    setPicked((saved.amenities ?? []).filter(isAmenity));
    return true;
  }

  return (
    <>
      <Card className={styles.stack}>
        <div>
          <p className={styles.cardTitle}>{t('showcase.amenities')}</p>
          <p className={styles.hint}>{t('showcase.amenities.hint')}</p>
        </div>
        <div className={own.amenities}>
          {AMENITIES.map((a) => {
            const Icon = AMENITY_ICONS[a];
            return (
              <Checkbox key={a} checked={picked.includes(a)} onChange={(e) => toggle(a, e.target.checked)}>
                <span className={own.amenity}>
                  <Icon size={16} aria-hidden="true" />
                  {t(`amenity.${a}` as MessageKey)}
                </span>
              </Checkbox>
            );
          })}
        </div>
      </Card>
      <SaveButton onSave={save}>{t('showcase.amenities.save')}</SaveButton>
    </>
  );
}
