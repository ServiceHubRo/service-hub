import type { ReactNode } from 'react';
import { ADMIN_ZONES, type AdminZoneItem } from '../../app/adminZones';
import { PageHeader } from '../../components/PageHeader';
import { Section } from '../../components/Section';
import { Tile } from '../../components/Tile';
import { useI18n } from '../../i18n/context';
import { plural } from '../../i18n/translate';
import accountStyles from '../account/account.module.css';
import { useOptionalAdminCounts } from './adminContext';
import { ADMIN_MODERATION_PATH } from './paths';
import styles from './admin.module.css';

/**
 * A zone's page (A1): its sub-sections as tiles — the first page of the zone on a phone, where the
 * bottom bar only holds the five zones; on a laptop the sidebar lists them too. Platformă shows its
 * two groups, Configurare and Control. The reported reviews waiting are counted on Moderare.
 */
export function ZoneScreen({ path }: { path: string }) {
  const { t, lang } = useI18n();
  const counts = useOptionalAdminCounts();
  const zone = ADMIN_ZONES.find((z) => z.path === path);
  if (!zone) return null;

  const tile = (item: AdminZoneItem) => {
    const waiting = item.path === ADMIN_MODERATION_PATH && (counts?.pendingReports ?? 0) > 0 ? counts!.pendingReports! : 0;
    const hint = waiting > 0 ? `${t(item.hintKey)} · ${plural(lang, 'unit.reportsPending', waiting)}` : t(item.hintKey);
    return <Tile key={item.path} to={item.path} icon={item.icon} label={t(item.labelKey)} hint={hint} />;
  };
  const tiles = (items: AdminZoneItem[]): ReactNode => (
    <div className={accountStyles.tiles} data-layout="tiles">
      {items.map(tile)}
    </div>
  );
  const grouped = zone.items.some((item) => item.group);

  return (
    <div className={styles.page}>
      <PageHeader title={t(zone.titleKey)} subtitle={t(zone.descKey)} />
      {grouped ? (
        <>
          <Section title={t('admin.zone.group.config')}>{tiles(zone.items.filter((i) => i.group === 'config'))}</Section>
          <Section title={t('admin.zone.group.control')}>{tiles(zone.items.filter((i) => i.group === 'control'))}</Section>
        </>
      ) : (
        tiles(zone.items)
      )}
    </div>
  );
}
