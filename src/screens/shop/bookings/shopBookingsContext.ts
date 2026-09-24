import { createContext, useContext } from 'react';
import type { Booking } from '../../../data/rpc';
import type { ShopBookingsData } from '../../../data/shopBookings';
import type { LoadState } from '../../../lib/useLoad';

export interface ShopBookingsValue {
  state: LoadState<ShopBookingsData>;
  /** After a failed load: shows loading again and reads the list. */
  reload: () => void;
  /** Reads the list again quietly (the screen keeps showing the current one). */
  refresh: () => void;
  /** Puts a booking an RPC returned into the list at once (a finished one leaves it). */
  apply: (row: Booking) => void;
}

export const ShopBookingsContext = createContext<ShopBookingsValue | null>(null);

/** The shop's active bookings, shared by Panou, Programări and the tab badge. */
export function useShopBookings(): ShopBookingsValue {
  const value = useContext(ShopBookingsContext);
  if (!value) throw new Error('useShopBookings outside ShopBookingsProvider');
  return value;
}

/** Null outside the shop interface (the shell of the other roles). */
export function useOptionalShopBookings(): ShopBookingsValue | null {
  return useContext(ShopBookingsContext);
}
