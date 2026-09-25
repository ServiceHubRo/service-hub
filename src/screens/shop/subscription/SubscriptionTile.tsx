import { CreditCard } from 'lucide-react';
import { useCallback } from 'react';
import { Tile } from '../../../components/Tile';
import { getSubscriptionRow } from '../../../data/subscription';
import { useI18n } from '../../../i18n/context';
import { plural } from '../../../i18n/translate';
import { subscriptionView } from '../../../lib/subscription';
import { useLoad } from '../../../lib/useLoad';
import { SUBSCRIPTION_PATH } from '../paths';

/**
 * The Abonament tile in the shop's Cont, for the owner only: the subscription row is readable by
 * the owner alone (RLS), so staff simply get no tile. The hint says where it stands
 * ("Perioadă gratuită · 74 de zile", "Activ", "Plată restantă").
 */
export function SubscriptionTile() {
  const { t, lang } = useI18n();
  const load = useCallback(() => getSubscriptionRow(), []);
  const { state } = useLoad(load);
  if (state.status !== 'ready' || !state.data) return null;
  const view = subscriptionView(state.data);
  const hint =
    view.state === 'trial' && view.daysLeft !== null
      ? t('sub.tile.trial', { days: plural(lang, 'unit.days', view.daysLeft) })
      : t(`sub.state.${view.state}`);
  return <Tile to={SUBSCRIPTION_PATH} icon={CreditCard} label={t('sub.title')} hint={hint} />;
}
