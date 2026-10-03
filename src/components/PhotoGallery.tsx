import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/context';
import styles from './PhotoGallery.module.css';

/**
 * The shop's photos (T28b): a row that scrolls sideways; a tap opens the photo large, with previous,
 * next and close (arrow keys and Escape too). The large view is a native <dialog>, so focus stays
 * inside it and returns to the photo tapped.
 */
export function PhotoGallery({ photos, shopName }: { photos: { id: string; url: string }[]; shopName: string }) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open !== null && !d.open) d.showModal?.();
    if (open === null && d.open) d.close();
  }, [open]);

  if (photos.length === 0) return null;
  const n = photos.length;
  const shown = open === null ? null : photos[open];
  const go = (by: number) => setOpen((i) => (i === null ? i : (i + by + n) % n));

  return (
    <>
      <ul className={styles.strip} aria-label={t('gallery.label', { name: shopName })}>
        {photos.map((p, i) => (
          <li key={p.id}>
            <button type="button" className={styles.thumb} onClick={() => setOpen(i)} aria-label={t('gallery.open', { n: i + 1, total: n })}>
              <img src={p.url} alt="" loading={i < 2 ? 'eager' : 'lazy'} />
            </button>
          </li>
        ))}
      </ul>
      <dialog
        ref={dialogRef}
        className={styles.dialog}
        aria-label={t('gallery.label', { name: shopName })}
        onClose={() => setOpen(null)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') go(-1);
          if (e.key === 'ArrowRight') go(1);
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) setOpen(null);
        }}
      >
        {shown && (
          <figure className={styles.figure}>
            <img src={shown.url} alt={t('gallery.photo', { n: (open ?? 0) + 1, total: n, name: shopName })} />
            <figcaption className={styles.caption}>
              {(open ?? 0) + 1} / {n}
            </figcaption>
          </figure>
        )}
        <div className={styles.controls}>
          {n > 1 && (
            <button type="button" className={styles.control} onClick={() => go(-1)} aria-label={t('gallery.prev')}>
              <ChevronLeft size={22} aria-hidden="true" />
            </button>
          )}
          <button type="button" className={styles.control} onClick={() => setOpen(null)} aria-label={t('gallery.close')}>
            <X size={22} aria-hidden="true" />
          </button>
          {n > 1 && (
            <button type="button" className={styles.control} onClick={() => go(1)} aria-label={t('gallery.next')}>
              <ChevronRight size={22} aria-hidden="true" />
            </button>
          )}
        </div>
      </dialog>
    </>
  );
}
