import { FileText, Image as ImageIcon, Loader2, Paperclip, X } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { ActionButton } from '../../components/ActionButton';
import { rpcErrorMessage } from '../../data/rpc';
import {
  FileError,
  openSupportFile,
  SUPPORT_FILE_MAX_BYTES,
  SUPPORT_FILE_TYPES,
  SUPPORT_FILES_PER_MESSAGE,
  uploadSupportFile,
  type RequestFile,
  type UploadedFile,
} from '../../data/supportFiles';
import { useI18n } from '../../i18n/context';
import { formatDecimal } from '../../i18n/format';
import type { Lang } from '../../i18n/translate';
import { whenText } from './format';
import styles from './requests.module.css';

type Picked = { key: string; name: string } & ({ state: 'uploading' } | { state: 'ready'; file: UploadedFile } | { state: 'error'; message: string });

/** `340 KB`, `1,2 MB` */
function sizeText(lang: Lang, bytes: number): string {
  return bytes >= 1024 * 1024 ? `${formatDecimal(lang, bytes / 1024 / 1024)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * „Atașează fișiere” (A3b): each file chosen is uploaded at once to the Edge Function, which checks it
 * on the server; it shows its own state (uploading, ready, refused with why). The files ready are sent
 * with the request or the message (`onChange` gives their ids). At most 5 per message. Removing one
 * here only leaves it out: a file never sent is deleted after 24 hours.
 */
export function AttachmentPicker({ onChange, disabled = false }: { onChange: (ids: string[]) => void; disabled?: boolean }) {
  const { t, lang } = useI18n();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [limit, setLimit] = useState(false);

  function update(next: (p: Picked[]) => Picked[]) {
    setPicked((prev) => {
      const list = next(prev);
      onChange(list.flatMap((x) => (x.state === 'ready' ? [x.file.id] : [])));
      return list;
    });
  }

  async function add(files: FileList | null) {
    if (!files) return;
    const room = SUPPORT_FILES_PER_MESSAGE - picked.filter((p) => p.state !== 'error').length;
    const chosen = Array.from(files).slice(0, Math.max(0, room));
    setLimit(files.length > room);
    for (const file of chosen) {
      const key = `${file.name}-${file.size}-${Math.random()}`;
      // The same limits as the server, so a wrong file is named at once (the server checks again).
      const early =
        file.size > SUPPORT_FILE_MAX_BYTES
          ? t('support.files.err.file_too_large')
          : !(SUPPORT_FILE_TYPES as readonly string[]).includes(file.type)
            ? t('support.files.err.file_type')
            : null;
      if (early) {
        update((p) => [...p, { key, name: file.name, state: 'error', message: early }]);
        continue;
      }
      update((p) => [...p, { key, name: file.name, state: 'uploading' }]);
      try {
        const uploaded = await uploadSupportFile(file);
        update((p) => p.map((x) => (x.key === key ? { key, name: uploaded.name, state: 'ready', file: uploaded } : x)));
      } catch (e) {
        const message = e instanceof FileError ? t(`support.files.err.${e.code}`) : rpcErrorMessage(lang, e);
        update((p) => p.map((x) => (x.key === key ? { key, name: file.name, state: 'error', message } : x)));
      }
    }
    if (inputRef.current) inputRef.current.value = '';
  }

  const full = picked.filter((p) => p.state !== 'error').length >= SUPPORT_FILES_PER_MESSAGE;
  return (
    <div className={styles.attach}>
      <input
        ref={inputRef}
        id={inputId}
        className="visually-hidden"
        type="file"
        multiple
        accept={SUPPORT_FILE_TYPES.join(',')}
        disabled={disabled || full}
        onChange={(e) => void add(e.target.files)}
      />
      <label htmlFor={inputId} className={styles.attachButton} aria-disabled={disabled || full || undefined}>
        <Paperclip size={18} aria-hidden="true" />
        {t('support.files.attach')}
      </label>
      <p className={styles.muted}>{t('support.files.rules')}</p>
      {limit && (
        <p className={styles.fileError} role="alert">
          {t('support.files.limitReached')}
        </p>
      )}
      {picked.length > 0 && (
        <ul className={styles.fileList}>
          {picked.map((p) => (
            <li key={p.key} className={styles.pickedRow}>
              {p.state === 'uploading' ? <Loader2 size={18} className={styles.spin} aria-hidden="true" /> : <Paperclip size={18} aria-hidden="true" />}
              <span className={styles.pickedText}>
                <span className={styles.fileName}>{p.name}</span>
                {p.state === 'uploading' && <span className={styles.muted}>{t('support.files.uploading')}</span>}
                {p.state === 'ready' && <span className={styles.muted}>{sizeText(lang, p.file.size)}</span>}
                {p.state === 'error' && (
                  <span className={styles.fileError} role="alert">
                    {p.message}
                  </span>
                )}
              </span>
              {p.state !== 'uploading' && (
                <button
                  type="button"
                  className={styles.iconButton}
                  aria-label={t('support.files.remove', { name: p.name })}
                  onClick={() => update((list) => list.filter((x) => x.key !== p.key))}
                >
                  <X size={18} aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className={styles.warning}>{t('support.files.privacy')}</p>
    </div>
  );
}

/**
 * The files of a description or a message: name, type, size and „Deschide” (a PDF: „Descarcă"). A file
 * opens only when asked (every opening is logged); the admin also sees who opened each one.
 */
export function FileList({ files, showOpens = false }: { files: RequestFile[]; showOpens?: boolean }) {
  const { t, lang } = useI18n();
  if (files.length === 0) return null;
  return (
    <ul className={styles.fileList} aria-label={t('support.files.list')}>
      {files.map((f) => {
        const pdf = f.mime === 'application/pdf';
        return (
          <li key={f.id} className={styles.fileItem}>
            <span className={styles.fileRow}>
              {pdf ? <FileText size={18} aria-hidden="true" /> : <ImageIcon size={18} aria-hidden="true" />}
              <span className={styles.fileName}>{f.name}</span>
              <span className={styles.muted}>{sizeText(lang, f.size)}</span>
              <ActionButton
                variant="secondary"
                block={false}
                onAction={async () => {
                  // The new tab opens at the tap (a later one would be blocked), then gets the link.
                  const tab = window.open('', '_blank');
                  try {
                    const { url } = await openSupportFile(f.id);
                    if (tab) tab.location.href = url;
                    else window.location.assign(url);
                  } catch (e) {
                    tab?.close();
                    throw e;
                  }
                }}
                errorMessage={(e) => rpcErrorMessage(lang, e)}
              >
                {t(pdf ? 'support.files.download' : 'support.files.open')}
              </ActionButton>
            </span>
            {showOpens && f.opens && (
              <span className={styles.muted}>
                {f.opens.length === 0
                  ? t('support.files.neverOpened')
                  : f.opens
                      .map((o) => t('support.files.openedBy', { who: [o.by, o.name].filter(Boolean).join(' · ') || '—', date: whenText(lang, o.at) }))
                      .join(' · ')}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
