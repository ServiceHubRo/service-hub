import { useCallback, useState } from 'react';
import { useSession } from '../../app/sessionContext';
import { fetchHelpCenter } from '../../data/help';
import { useI18n } from '../../i18n/context';
import { useLoad } from '../../lib/useLoad';

/** The Help Center in the interface language, loaded once per language (data/help.ts keeps it). */
export function useHelpCenter() {
  const { lang } = useI18n();
  const { profile } = useSession();
  const account = profile?.id ?? '';
  const [fresh, setFresh] = useState(0);
  // A retry after an error asks the server again instead of the cache.
  const load = useCallback(() => fetchHelpCenter(account, lang, fresh > 0), [account, lang, fresh]);
  const { state } = useLoad(load);
  const reload = useCallback(() => setFresh((n) => n + 1), []);
  return { state, reload };
}
