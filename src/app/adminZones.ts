import {
  Activity,
  BellOff,
  ClipboardList,
  Copy,
  CreditCard,
  Download,
  FileCheck,
  FileLock,
  FileSearch,
  Handshake,
  Inbox,
  Landmark,
  LayoutDashboard,
  LifeBuoy,
  ListTree,
  MapPinned,
  Megaphone,
  MessageSquareText,
  ScrollText,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Timer,
  Store,
  Truck,
  UserCog,
  UserX,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { MessageKey } from '../i18n/ro';
import {
  ADMIN_ACTIVITY_PATH,
  ADMIN_ANAF_PATH,
  ADMIN_AUDIT_PATH,
  ADMIN_BOOKINGS_PATH,
  ADMIN_CATALOG_PATH,
  ADMIN_CLIENTS_PATH,
  ADMIN_DISPUTES_PATH,
  ADMIN_DUPLICATES_PATH,
  ADMIN_EXPORT_PATH,
  ADMIN_FLEET_FAILED_PATH,
  ADMIN_FLEETS_PATH,
  ADMIN_HOLDS_PATH,
  ADMIN_MODERATION_PATH,
  ADMIN_NOTICES_PATH,
  ADMIN_PANEL_PATH,
  ADMIN_PARTNERS_PATH,
  ADMIN_PLATFORM_PATH,
  ADMIN_REPORTS_PATH,
  ADMIN_SETTINGS_PATH,
  ADMIN_SHOPS_PATH,
  ADMIN_SUBSCRIPTIONS_PATH,
  ADMIN_REQUESTS_PATH,
  ADMIN_SUPPORT_PATH,
  ADMIN_RETENTION_PATH,
  ADMIN_TEAM_PATH,
  ADMIN_TEXT_REVIEWS_PATH,
  ADMIN_TEXTS_PATH,
  ADMIN_ZONES_PATH,
} from '../screens/admin/paths';

/** A sub-section of a zone: one screen, one place (A1). */
export interface AdminZoneItem {
  path: string;
  labelKey: MessageKey;
  hintKey: MessageKey;
  icon: LucideIcon;
  /** Platformă splits its sub-sections in two titled groups. */
  group?: 'config' | 'control';
}

/** One of the admin's five zones: the bottom bar on a phone, the sidebar from 1024 px. */
export interface AdminZone {
  path: string;
  labelKey: MessageKey;
  /** The bottom bar's label, where five items share 320 px. */
  shortLabelKey: MessageKey;
  /** The zone's page: its title and the line under it. */
  titleKey: MessageKey;
  descKey: MessageKey;
  icon: LucideIcon;
  /** Empty for Panou (one page, no sub-sections). */
  items: AdminZoneItem[];
}

/**
 * The admin's navigation (Eduard, 7 Nov 2026: O1, A1): five zones, at most one level of
 * sub-sections, every function in exactly one place. The single source for the menu, the zone pages
 * and the tests.
 */
export const ADMIN_ZONES: readonly AdminZone[] = [
  {
    path: ADMIN_PANEL_PATH,
    labelKey: 'nav.admin.overviewShort',
    shortLabelKey: 'nav.admin.overviewShort',
    titleKey: 'nav.admin.overview',
    descKey: 'admin.zone.panel.desc',
    icon: LayoutDashboard,
    items: [],
  },
  {
    path: ADMIN_PARTNERS_PATH,
    labelKey: 'nav.admin.partners',
    shortLabelKey: 'nav.admin.partnersShort',
    titleKey: 'nav.admin.partners',
    descKey: 'admin.zone.partners.desc',
    icon: Handshake,
    items: [
      { path: ADMIN_CLIENTS_PATH, labelKey: 'nav.admin.clients', hintKey: 'admin.zone.clients.hint', icon: Users },
      { path: ADMIN_SHOPS_PATH, labelKey: 'nav.admin.shops', hintKey: 'admin.zone.shops.hint', icon: Store },
      { path: ADMIN_FLEETS_PATH, labelKey: 'admin.fleets.title', hintKey: 'admin.fleets.tileHint', icon: Truck },
      { path: ADMIN_ANAF_PATH, labelKey: 'anaf.title', hintKey: 'anaf.tileHint', icon: Landmark },
      { path: ADMIN_DUPLICATES_PATH, labelKey: 'admin.dup.title', hintKey: 'admin.dup.tileHint', icon: Copy },
    ],
  },
  {
    path: ADMIN_ACTIVITY_PATH,
    labelKey: 'nav.admin.activity',
    shortLabelKey: 'nav.admin.activityShort',
    titleKey: 'nav.admin.activity',
    descKey: 'admin.zone.activity.desc',
    icon: Activity,
    items: [
      { path: ADMIN_BOOKINGS_PATH, labelKey: 'nav.admin.bookings', hintKey: 'admin.zone.bookings.hint', icon: ClipboardList },
      { path: ADMIN_MODERATION_PATH, labelKey: 'nav.admin.moderation', hintKey: 'admin.zone.moderation.hint', icon: ShieldCheck },
      { path: ADMIN_DISPUTES_PATH, labelKey: 'admin.disputes.title', hintKey: 'admin.zone.disputes.hint', icon: UserX },
      { path: ADMIN_SUBSCRIPTIONS_PATH, labelKey: 'admin.subs.title', hintKey: 'admin.subs.tileHint', icon: CreditCard },
      { path: ADMIN_REPORTS_PATH, labelKey: 'admin.reports.title', hintKey: 'admin.reports.tileHint', icon: FileCheck },
      { path: ADMIN_EXPORT_PATH, labelKey: 'admin.export.title', hintKey: 'admin.export.tileHint', icon: Download },
    ],
  },
  {
    path: ADMIN_SUPPORT_PATH,
    labelKey: 'nav.admin.support',
    shortLabelKey: 'nav.admin.supportShort',
    titleKey: 'nav.admin.support',
    descKey: 'admin.zone.support.desc',
    icon: LifeBuoy,
    items: [
      { path: ADMIN_REQUESTS_PATH, labelKey: 'admin.requests.title', hintKey: 'admin.requests.tileHint', icon: Inbox },
      { path: ADMIN_HOLDS_PATH, labelKey: 'admin.holds.title', hintKey: 'admin.holds.tileHint', icon: FileLock },
      { path: ADMIN_TEXT_REVIEWS_PATH, labelKey: 'support.textReview.title', hintKey: 'support.textReview.tileHint', icon: FileSearch },
    ],
  },
  {
    path: ADMIN_PLATFORM_PATH,
    labelKey: 'nav.admin.platform',
    shortLabelKey: 'nav.admin.platformShort',
    titleKey: 'nav.admin.platform',
    descKey: 'admin.zone.platform.desc',
    icon: Settings,
    items: [
      { path: ADMIN_SETTINGS_PATH, labelKey: 'admin.settings.title', hintKey: 'admin.settings.tileHint', icon: SlidersHorizontal, group: 'config' },
      { path: ADMIN_TEXTS_PATH, labelKey: 'admin.texts.title', hintKey: 'admin.texts.tileHint', icon: MessageSquareText, group: 'config' },
      { path: ADMIN_NOTICES_PATH, labelKey: 'admin.notices.title', hintKey: 'admin.notices.tileHint', icon: Megaphone, group: 'config' },
      { path: ADMIN_ZONES_PATH, labelKey: 'admin.areas.title', hintKey: 'admin.areas.tileHint', icon: MapPinned, group: 'config' },
      { path: ADMIN_CATALOG_PATH, labelKey: 'admin.catalog.title', hintKey: 'admin.catalog.tileHint', icon: ListTree, group: 'config' },
      { path: ADMIN_AUDIT_PATH, labelKey: 'admin.audit.title', hintKey: 'admin.audit.tileHint', icon: ScrollText, group: 'control' },
      { path: ADMIN_FLEET_FAILED_PATH, labelKey: 'admin.fleetFailed.title', hintKey: 'admin.fleetFailed.tileHint', icon: BellOff, group: 'control' },
      { path: ADMIN_TEAM_PATH, labelKey: 'admin.team.title', hintKey: 'admin.team.tileHint', icon: UserCog, group: 'control' },
      { path: ADMIN_RETENTION_PATH, labelKey: 'admin.retention.title', hintKey: 'admin.retention.tileHint', icon: Timer, group: 'control' },
    ],
  },
];

/** The zone a path belongs to (a fișă belongs to the zone of its list). */
export function adminZoneOf(pathname: string): AdminZone | undefined {
  return ADMIN_ZONES.find((z) => pathname === z.path || pathname.startsWith(`${z.path}/`));
}

/** The zone a sub-section's screen goes back to („‹ Parteneri”). */
export function adminZoneBack(path: string): { to: string; label: MessageKey } {
  const zone = adminZoneOf(path);
  if (!zone) throw new Error(`${path} is in no admin zone`);
  return { to: zone.path, label: zone.labelKey };
}
