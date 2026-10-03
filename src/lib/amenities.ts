import { BadgeCheck, Car, Coffee, CreditCard, Sofa, Truck, Wifi, Zap, type LucideIcon } from 'lucide-react';

/** The facilities a shop can tick (T28b); the database accepts exactly these. */
export const AMENITIES = ['waiting_room', 'wifi', 'coffee', 'courtesy_car', 'card_payment', 'pickup', 'hybrid_ev', 'warranty'] as const;
export type Amenity = (typeof AMENITIES)[number];

export const AMENITY_ICONS: Record<Amenity, LucideIcon> = {
  waiting_room: Sofa,
  wifi: Wifi,
  coffee: Coffee,
  courtesy_car: Car,
  card_payment: CreditCard,
  pickup: Truck,
  hybrid_ev: Zap,
  warranty: BadgeCheck,
};

export function isAmenity(value: string): value is Amenity {
  return (AMENITIES as readonly string[]).includes(value);
}
