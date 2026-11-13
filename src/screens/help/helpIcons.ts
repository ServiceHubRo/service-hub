import { Bell, BookOpen, CalendarDays, Car, CreditCard, FileText, ShieldCheck, Truck, Users, Wrench, type LucideIcon } from 'lucide-react';
import type { HelpIcon } from '../../data/help';

/** The icon of each Help Center category (A4). */
export const HELP_ICON: Record<HelpIcon, LucideIcon> = {
  book: BookOpen,
  car: Car,
  wrench: Wrench,
  truck: Truck,
  shield: ShieldCheck,
  card: CreditCard,
  calendar: CalendarDays,
  bell: Bell,
  users: Users,
  file: FileText,
};
