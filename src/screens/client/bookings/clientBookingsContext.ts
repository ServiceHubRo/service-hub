import { createContext, useContext } from 'react';
import type { ClientBooking, ClientBookingsData } from '../../../data/bookings';
import type { Booking } from '../../../data/rpc';
import type { LoadState } from '../../../lib/useLoad';

export interface ClientBookingsValue {
  state: LoadState<ClientBookingsData>;
  /** After a failed load: shows loading again and reads the list. */
  reload: () => void;
  /** Reads the list again quietly (the screen keeps showing the current one). */
  refresh: () => void;
  /** Puts a booking an RPC returned into the list at once, then reads the rest (quotes) quietly. */
  apply: (row: Booking) => void;
  /** Changes one booking in place (a review just sent). */
  patch: (id: string, change: Partial<ClientBooking>) => void;
}

export const ClientBookingsContext = createContext<ClientBookingsValue | null>(null);

/** The client's bookings, shared by Programări and the badge on its tab. */
export function useClientBookings(): ClientBookingsValue {
  const value = useContext(ClientBookingsContext);
  if (!value) throw new Error('useClientBookings outside ClientBookingsProvider');
  return value;
}

/** Null outside the client interface (the shell of the other roles). */
export function useOptionalClientBookings(): ClientBookingsValue | null {
  return useContext(ClientBookingsContext);
}
