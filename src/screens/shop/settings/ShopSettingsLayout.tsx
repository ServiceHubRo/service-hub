import { Unlink } from 'lucide-react';
import { useCallback } from 'react';
import { Outlet } from 'react-router-dom';
import { useSession } from '../../../app/sessionContext';
import { EmptyState } from '../../../components/EmptyState';
import { SkeletonList } from '../../../components/Skeleton';
import { fetchOwnShop } from '../../../data/shop';
import { useI18n } from '../../../i18n/context';
import { useLoad } from '../../../lib/useLoad';
import { LoadError } from '../../../components/LoadError';
import type { ShopSettingsContext } from './shopSettingsContext';

/** Loads the shop once for every settings section (/s/cont/setari/…). */
export function ShopSettingsLayout() {
  const { t } = useI18n();
  const session = useSession();
  const load = useCallback(() => fetchOwnShop(), []);
  const { state, reload, setData } = useLoad(load);

  if (state.status === 'loading') return <SkeletonList />;
  if (state.status === 'error') return <LoadError message={t('settings.loadError')} onRetry={reload} />;
  if (!state.data) return <EmptyState icon={Unlink} title={t('settings.noShop')} />;

  const context: ShopSettingsContext = {
    shop: state.data,
    setShop: setData,
    isOwner: state.data.owner_id === session.profile?.id,
  };
  return <Outlet context={context} />;
}
