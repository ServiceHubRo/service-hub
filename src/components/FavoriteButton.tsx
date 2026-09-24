import { Heart } from 'lucide-react';
import { toggleFavorite, rpcErrorMessage } from '../data/rpc';
import { useI18n } from '../i18n/context';
import { useAction } from './useAction';
import styles from './FavoriteButton.module.css';

export interface FavoriteButtonProps {
  shopId: string;
  shopName: string;
  on: boolean;
  onChange: (on: boolean) => void;
}

/**
 * The heart on a search result and on the shop page. A write like any other (CLAUDE.md §6.7):
 * locked while saving, one request id per tap (a retry reuses it), and an inline error with
 * "Încearcă din nou" under the heart. The heart changes only when the database answered.
 */
export function FavoriteButton({ shopId, shopName, on, onChange }: FavoriteButtonProps) {
  const { t, lang } = useI18n();
  const { run, busy, error } = useAction(
    async (requestId) => {
      onChange(await toggleFavorite(shopId, requestId));
    },
    { errorMessage: (e) => rpcErrorMessage(lang, e) },
  );

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={`${styles.heart} ${on ? styles.on : ''}`}
        aria-pressed={on}
        aria-label={t(on ? 'favorite.remove' : 'favorite.add', { name: shopName })}
        aria-busy={busy}
        disabled={busy}
        onClick={() => void run()}
      >
        <Heart size={22} aria-hidden="true" />
      </button>
      {error && (
        <div className={styles.error} role="alert">
          <span>{error.text}</span>
          {error.retry && (
            <button type="button" className={styles.retry} onClick={() => void run()}>
              {t('action.retry')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
