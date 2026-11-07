import { CalendarDays, Car, History, LayoutDashboard, MessageSquare, Search, User, type LucideIcon } from 'lucide-react';
import type { MessageKey } from '../i18n/ro';
import { ADMIN_ZONES } from './adminZones';

export type Role = 'client' | 'shop' | 'admin';

export interface NavItem {
  path: string;
  labelKey: MessageKey;
  /** A shorter label for the mobile bottom bar, where five items share 390 px. */
  shortLabelKey?: MessageKey;
  icon: LucideIcon;
  /** The admin's zones (A1): their sub-sections, under the zone in the sidebar. */
  children?: NavItem[];
}

export interface RoleNav {
  /** Base path of every route of this role. */
  base: string;
  /** Main items: top of the desktop sidebar. */
  main: NavItem[];
  /** Cont: pinned to the bottom of the desktop sidebar. */
  account: NavItem;
  /** Exactly five items in the mobile/tablet bottom bar (CLAUDE.md §1). */
  bottomBar: NavItem[];
}

const account = (base: string): NavItem => ({ path: `${base}/cont`, labelKey: 'nav.account', icon: User });

const clientMain: NavItem[] = [
  { path: '/c/cauta', labelKey: 'nav.client.search', icon: Search },
  { path: '/c/garaj', labelKey: 'nav.client.garage', icon: Car },
  { path: '/c/programari', labelKey: 'nav.bookings', icon: CalendarDays },
  { path: '/c/mesaje', labelKey: 'nav.messages', icon: MessageSquare },
];

const shopMain: NavItem[] = [
  { path: '/s/panou', labelKey: 'nav.shop.dashboard', icon: LayoutDashboard },
  { path: '/s/programari', labelKey: 'nav.bookings', icon: CalendarDays },
  { path: '/s/istoric', labelKey: 'nav.shop.history', icon: History },
  { path: '/s/mesaje', labelKey: 'nav.messages', icon: MessageSquare },
];

// Admin: five zones (A1, src/app/adminZones.ts), each with its sub-sections; its own Cont is reached
// from the header (and the bottom of the sidebar).
const adminMain: NavItem[] = ADMIN_ZONES.map((zone) => ({
  path: zone.path,
  labelKey: zone.labelKey,
  shortLabelKey: zone.shortLabelKey,
  icon: zone.icon,
  children: zone.items.map((item) => ({ path: item.path, labelKey: item.labelKey, icon: item.icon })),
}));

export const NAV: Record<Role, RoleNav> = {
  client: { base: '/c', main: clientMain, account: account('/c'), bottomBar: [...clientMain, account('/c')] },
  shop: { base: '/s', main: shopMain, account: account('/s'), bottomBar: [...shopMain, account('/s')] },
  admin: { base: '/admin', main: adminMain, account: account('/admin'), bottomBar: adminMain },
};

export function homeOf(role: Role): string {
  return NAV[role].main[0]!.path;
}

/** Where a user lands after signing in: the page they asked for if it is theirs, else their home. */
export function afterSignIn(role: Role, from: string | undefined): string {
  const base = NAV[role].base;
  return from && (from === base || from.startsWith(`${base}/`)) ? from : homeOf(role);
}
