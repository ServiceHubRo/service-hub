import { useLocation, useParams } from 'react-router-dom';
import { DetailFrame } from '../../components/ListDetailLayout';
import { EmbeddedProvider } from '../../lib/embedded';
import { LIST_DETAIL_QUERY, useMediaQuery } from '../../lib/useMediaQuery';
import { TeamNoticesScreen } from '../notices/TeamNoticesScreen';
import { ConversationScreen } from './ConversationScreen';
import { MessagesScreen } from './MessagesScreen';
import { TEAM_ROW } from './paths';

/**
 * Mesaje on a laptop (C9, Eduard, 21 Nov 2026): the conversations on the left, the one chosen on the
 * right — a conversation is not a long card across the screen. On a phone, as before: the list, and a
 * conversation as a page of its own. Every address of Mesaje (the list, /echipa, /:threadId) renders
 * this, so the list stays where it is while the conversation changes.
 */
export function MessagesSpace() {
  const wide = useMediaQuery(LIST_DETAIL_QUERY);
  const { threadId } = useParams();
  const { pathname } = useLocation();
  const team = pathname.replace(/\/+$/, '').endsWith(`/${TEAM_ROW}`);
  const screen = team ? <TeamNoticesScreen /> : threadId ? <ConversationScreen /> : null;
  if (!wide) return screen ?? <MessagesScreen />;
  return (
    <MessagesScreen
      wide
      selectedId={team ? TEAM_ROW : threadId}
      detail={
        screen && (
          <DetailFrame>
            <EmbeddedProvider value>{screen}</EmbeddedProvider>
          </DetailFrame>
        )
      }
    />
  );
}
