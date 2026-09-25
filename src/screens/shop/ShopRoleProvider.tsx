import { useCallback, type ReactNode } from 'react';
import { useSession } from '../../app/sessionContext';
import { fetchMyShopRole } from '../../data/shop';
import { useLoad } from '../../lib/useLoad';
import { ShopRoleContext } from './shopRole';

/**
 * Whether the signed-in shop account is the owner or a colleague, read once for the whole shop
 * interface. The screens hide what a colleague may not do (settings, review replies, the takings);
 * the database refuses it anyway. Until it is known, owner-only controls stay hidden.
 */
export function ShopRoleProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const userId = session.profile?.id ?? null;
  const load = useCallback(() => (userId ? fetchMyShopRole(userId) : Promise.resolve(null)), [userId]);
  const { state } = useLoad(load);
  return <ShopRoleContext.Provider value={state.status === 'ready' ? state.data : null}>{children}</ShopRoleContext.Provider>;
}
