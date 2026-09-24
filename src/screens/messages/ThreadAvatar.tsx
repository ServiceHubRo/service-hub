import { ShopAvatar } from '../../components/ShopAvatar';
import type { ThreadSummary } from '../../data/messages';
import { useI18n } from '../../i18n/context';
import { counterpartName, type Side } from '../../lib/messages';

/** The other side of a conversation: the shop's logo or initials for a client; the client's initials for a shop. */
export function ThreadAvatar({ side, thread, size = 44 }: { side: Side; thread: ThreadSummary; size?: number }) {
  const { t } = useI18n();
  return side === 'client' ? (
    <ShopAvatar name={thread.shop_name} logoUrl={thread.shop_logo_url} size={size} />
  ) : (
    <ShopAvatar name={counterpartName(side, thread, t('msg.deletedAccount'))} logoUrl={null} size={size} />
  );
}
