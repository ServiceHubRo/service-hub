import {
  CalendarDays,
  Car,
  ClipboardList,
  History,
  LayoutDashboard,
  MessageSquare,
  Search,
  ShieldCheck,
  Store,
  User,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { MessageKey } from '../i18n/ro';

export type Role = 'client' | 'shop' | 'admin';

export interface NavItem {
  path: string;
  labelKey: MessageKey;
  icon: LucideIcon;
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

// Admin has five main items; its Cont (platform tools) is reached from the header/sidebar.
const adminMain: NavItem[] = [
  { path: '/admin/prezentare', labelKey: 'nav.admin.overview', icon: LayoutDashboard },
  { path: '/admin/service-uri', labelKey: 'nav.admin.shops', icon: Store },
  { path: '/admin/clienti', labelKey: 'nav.admin.clients', icon: Users },
  { path: '/admin/rezervari', labelKey: 'nav.admin.bookings', icon: ClipboardList },
  { path: '/admin/moderare', labelKey: 'nav.admin.moderation', icon: ShieldCheck },
];

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
