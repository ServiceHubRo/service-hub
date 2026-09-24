import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useSession } from '../../../app/sessionContext';
import { fetchClientBookingsData, type ClientBooking } from '../../../data/bookings';
import { subscribeRows } from '../../../data/realtime';
import type { Booking } from '../../../data/rpc';
import type { BookingStatus } from '../../../lib/status';
import { useLoad } from '../../../lib/useLoad';
import { ClientBookingsContext, type ClientBookingsValue } from './clientBookingsContext';

/**
 * Loads the client's bookings once for the whole client interface and keeps them live
 * (CLAUDE.md §6.9): Realtime streams every change of this client's bookings; the changed row is
 * put into the list at once (status, times, the finished job), then the list is read again quietly
 * for what the row does not carry (a new quote and its lines). Programări and the badge on its tab
 * (quotes waiting for a decision) read from here.
 */
export function ClientBookingsProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const clientId = user?.id ?? '';
  const load = useCallback(() => fetchClientBookingsData(clientId), [clientId]);
  const { state, reload, setData } = useLoad(load);

  // A quiet read started before a newer change must not put the older list back.
  const generation = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      window.clearTimeout(timer.current);
    };
  }, []);

  const refresh = useCallback(() => {
    if (!clientId) return;
    window.clearTimeout(timer.current);
    // Several changes in a row (a quote replaced) cost one read.
    timer.current = window.setTimeout(function read() {
      const started = generation.current;
      fetchClientBookingsData(clientId).then(
        (data) => {
          if (!mounted.current) return;
          if (started === generation.current) setData(data);
          else timer.current = window.setTimeout(read, 0);
        },
        () => {}, // the list on screen stays; the next change or reconnect reads again
      );
    }, 150);
  }, [clientId, setData]);

  const patch = useCallback(
    (id: string, change: Partial<ClientBooking>) => {
      generation.current += 1;
      setData((prev) => ({ ...prev, bookings: prev.bookings.map((b) => (b.id === id ? { ...b, ...change } : b)) }));
    },
    [setData],
  );

  const apply = useCallback(
    (row: Booking) => {
      patch(row.id, {
        status: row.status as BookingStatus,
        date: row.date,
        slot: row.slot,
        note: row.note,
        inspection_started_at: row.inspection_started_at,
        started_at: row.started_at,
        done_at: row.done_at,
        odometer: row.odometer,
        work: row.work,
        cost: row.cost === null ? null : Number(row.cost),
        cancelled_by: row.cancelled_by as ClientBooking['cancelled_by'],
        cancel_reason: row.cancel_reason,
        decline_reason: row.decline_reason,
      });
      refresh();
    },
    [patch, refresh],
  );

  const ready = state.status === 'ready';
  useEffect(() => {
    if (!clientId || !ready) return;
    return subscribeRows<Booking>({
      channel: `client-bookings:${clientId}`,
      table: 'bookings',
      filter: `client_id=eq.${clientId}`,
      onChange: (payload) => {
        const row = payload.new as Partial<Booking>;
        if (payload.eventType === 'UPDATE' && row.id && row.status && row.date && row.slot) apply(row as Booking);
        else refresh(); // a new booking (from another device): its shop and service come with a read
      },
      onResync: refresh,
    });
  }, [clientId, ready, apply, refresh]);

  const value = useMemo<ClientBookingsValue>(
    () => ({ state, reload, refresh, apply, patch }),
    [state, reload, refresh, apply, patch],
  );
  return <ClientBookingsContext.Provider value={value}>{children}</ClientBookingsContext.Provider>;
}
