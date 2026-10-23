import { Megaphone } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BackLink } from '../../components/BackLink';
import { EmptyState } from '../../components/EmptyState';
import { SkeletonList } from '../../components/Skeleton';
import { useI18n } from '../../i18n/context';
import { ymdInBucharest } from '../../i18n/format';
import { formatDayHeading } from '../../lib/messages';
import { useNow } from '../../lib/useNow';
import { messagesPath } from '../messages/paths';
import { useThreads } from '../messages/threadsContext';
import msgStyles from '../messages/messages.module.css';
import { NoticeBubble } from './NoticeBubble';
import { TeamAvatar } from './TeamAvatar';
import { useOptionalNotices } from './noticesContext';
import styles from './notices.module.css';

/**
 * "Echipa Service-Hub" (Eduard, 23 Oct): the team's notices of the last 30 days as one conversation,
 * like the app's own chat in WhatsApp or Snapchat. Oldest first, the newest at the bottom, where the
 * screen opens (or at the notice a push was about, `?anunt=<id>`). Opening it reads them all; the
 * ones that were new keep "Nou" until the screen is left.
 */
export function TeamNoticesScreen() {
  const { t, lang } = useI18n();
  const { side } = useThreads();
  const notices = useOptionalNotices();
  const [params] = useSearchParams();
  const now = useNow();
  const loaded = notices?.loaded ?? false;
  const list = [...(notices?.notices ?? [])].reverse();

  // What was new when the screen opened (or arrived while it is open) stays marked as new here.
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set());
  const unreadIds = list.filter((n) => !n.read).map((n) => n.id);
  const unseen = unreadIds.filter((id) => !fresh.has(id));
  if (unseen.length > 0) setFresh(new Set([...fresh, ...unseen]));
  const unreadKey = unreadIds.join(',');
  useEffect(() => {
    if (unreadKey) notices?.markRead(unreadKey.split(','));
  }, [unreadKey, notices]);

  // Once the notices are on screen: to the one a push was about, else to the newest at the bottom.
  const placed = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  const target = params.get('anunt');
  useEffect(() => {
    if (!loaded || placed.current || list.length === 0) return;
    placed.current = true;
    const el = target ? document.getElementById(`anunt-${target}`) : null;
    if (el) {
      el.scrollIntoView({ block: 'center' });
      el.focus({ preventScroll: true });
    } else {
      endRef.current?.scrollIntoView({ block: 'end' });
    }
  }, [loaded, list.length, target]);

  return (
    <div className={msgStyles.conversation}>
      <div className={msgStyles.top}>
        <BackLink to={messagesPath(side)} label={t('nav.messages')} />
        <div className={msgStyles.header}>
          <TeamAvatar size={40} />
          <h1 className={msgStyles.headerName}>{t('notices.from')}</h1>
        </div>
      </div>
      {!loaded ? (
        <SkeletonList />
      ) : list.length === 0 ? (
        <EmptyState icon={Megaphone} title={t('notices.empty')} />
      ) : (
        <ol className={styles.feed} aria-label={t('notices.listLabel')}>
          {list.map((n, i) => {
            const day = ymdInBucharest(new Date(n.created_at));
            const prev = list[i - 1];
            const newDay = !prev || ymdInBucharest(new Date(prev.created_at)) !== day;
            return (
              <li key={n.id} className={msgStyles.item}>
                {newDay && <p className={msgStyles.day}>{formatDayHeading(lang, day, now)}</p>}
                <NoticeBubble id={`anunt-${n.id}`} notice={n} lang={lang} isNew={fresh.has(n.id)} />
              </li>
            );
          })}
        </ol>
      )}
      <div ref={endRef} />
    </div>
  );
}
