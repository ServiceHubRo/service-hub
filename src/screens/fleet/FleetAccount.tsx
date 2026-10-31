import { BarChart3, Building2, CreditCard, Users } from 'lucide-react';
import { Tile } from '../../components/Tile';
import { useI18n } from '../../i18n/context';
import { useFleet, type FleetSection } from './fleetContext';
import styles from './fleet.module.css';

/**
 * Cont in the company space (T63d): the pages used less often, as tiles — Rapoarte, Membri și roluri,
 * Abonament și facturare and the company's own page (details, rules, team). Each tile only for the
 * roles that may open it; the company's settings stay the admin's (on the company page).
 */
export function FleetAccount() {
  const { t } = useI18n();
  const { allowed, companyPage, data } = useFleet();
  const to = (s: FleetSection) => `?sectiune=${s}`;
  const top = () => document.getElementById('fleet-main')?.scrollTo?.({ top: 0 });
  return (
    <div className={styles.tiles}>
      {allowed('reports.view') && <Tile to={to('rapoarte')} onClick={top} icon={BarChart3} label={t('fleet.nav.rapoarte')} />}
      {allowed('members.manage') && <Tile to={to('membri')} onClick={top} icon={Users} label={t('fleet.nav.membri')} />}
      {data.me.role !== 'driver' && <Tile to={to('abonament')} onClick={top} icon={CreditCard} label={t('fleet.nav.abonament')} />}
      {companyPage && <Tile to={companyPage} icon={Building2} label={t('fleet.cont.company')} hint={t('fleet.cont.companyHint')} />}
    </div>
  );
}
