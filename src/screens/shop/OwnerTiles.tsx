import { BarChart3, CreditCard } from 'lucide-react';
import { useCallback } from 'react';
import { Tile } from '../../components/Tile';
import { getSubscriptionRow } from '../../data/subscription';
import { useI18n } from '../../i18n/context';
import { plural } from '../../i18n/translate';
import { subscriptionView } from '../../lib/subscription';
import { useLoad } from '../../lib/useLoad';
import { REPORTS_PATH, SUBSCRIPTION_PATH } from './paths';

/**
 * The owner's tiles in the shop's Cont: Abonament (T14) and Rapoarte (T17). The subscription row is
 * readable by the owner alone (RLS), so it tells who the owner is: staff simply get no tiles. The
 * Abonament hint says where it stands ("Perioadă gratuită · 74 de zile", "Activ", "Plată restantă").
 */
export function OwnerTiles() {
  const { t, lang } = useI18n();
  const load = useCallback(() => getSubscriptionRow(), []);
  const { state } = useLoad(load);
  if (state.status !== 'ready' || !state.data) return null;
  const view = subscriptionView(state.data);
  const hint =
    view.state === 'trial' && view.daysLeft !== null
      ? t('sub.tile.trial', { days: plural(lang, 'unit.days', view.daysLeft) })
      : t(`sub.state.${view.state}`);
  return (
    <>
      <Tile to={SUBSCRIPTION_PATH} icon={CreditCard} label={t('sub.title')} hint={hint} />
      <Tile to={REPORTS_PATH} icon={BarChart3} label={t('rep.title')} hint={t('rep.tileHint')} />
    </>
  );
}
