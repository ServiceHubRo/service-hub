import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { ensureBookingsChannel } from '../../../data/nativePush';
import { currentPushStatus, refreshPush } from '../../../data/push';
import { subscribeRows } from '../../../data/realtime';
import type { Booking } from '../../../data/rpc';
import { fetchShopBookings, type ShopBooking, type ShopBookingsData } from '../../../data/shopBookings';
import { playChime, primeChime } from '../../../lib/chime';
import { IS_NATIVE } from '../../../lib/native';
import { isActiveStatus, type BookingStatus } from '../../../lib/status';
import { useLoad } from '../../../lib/useLoad';
import { ShopBookingsContext, type ShopBookingsValue } from './shopBookingsContext';

/**
 * Loads the shop's active bookings once for the whole shop interface and keeps them live
 * (CLAUDE.md §6.9): Realtime streams every change of this shop's bookings; the changed row is put
 * into the list at once, then the list is read again quietly for what the row does not carry (the
 * quote, service names). Panou, Programări and the badge on the Programări tab all read from here,
 * so moving between them never shows a skeleton again. A request that arrives live is noted, so
 * the list can make it glow (`isFresh`), and rings the new-booking chime (T47) on this device: while
 * the app is on screen, or in a background tab when this device gets no push (the push brings its
 * own sound then).
 */
/** How long a request that arrived live keeps its glow when a list shows it. */
const FRESH_MS = 2 * 60 * 1000;

export function ShopBookingsProvider({ children }: { children: ReactNode }) {
  const load = useCallback(() => fetchShopBookings(), []);
  const { state, reload, setData } = useLoad(load);

  // The bookings on screen, and when each request that came in live arrived.
  const known = useRef<Set<string> | null>(null);
  const arrived = useRef(new Map<string, number>());
  useEffect(() => {
    if (state.status === 'ready') known.current = new Set(state.data.bookings.map((b) => b.id));
  }, [state]);
  const noteArrivals = useCallback((data: ShopBookingsData) => {
    const before = known.current;
    if (!before) return;
    const now = Date.now();
    let fromClient = false;
    for (const b of data.bookings) {
      if (before.has(b.id)) continue;
      if (b.status === 'pending') arrived.current.set(b.id, now);
      // Booked by a client (a request, or confirmed at once); not one the shop typed in itself.
      if (b.source !== 'shop') fromClient = true;
    }
    if (fromClient && (document.visibilityState === 'visible' || currentPushStatus() !== 'on')) void playChime();
  }, []);

  // Sound needs a first touch of the page (browser rule); the push state decides the background.
  // In the phone app, the channel whose notifications ring with the same chime.
  useEffect(() => {
    void refreshPush();
    if (IS_NATIVE) void ensureBookingsChannel();
    return primeChime();
  }, []);
  const isFresh = useCallback((id: string) => {
    const at = arrived.current.get(id);
    return at !== undefined && Date.now() - at < FRESH_MS;
  }, []);

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
    window.clearTimeout(timer.current);
    // Several changes in a row (a quote replaces the old one) cost one read.
    timer.current = window.setTimeout(function read() {
      const started = generation.current;
      fetchShopBookings().then(
        (data) => {
          if (!mounted.current) return;
          if (started === generation.current) {
            noteArrivals(data);
            setData(data);
          }
          else timer.current = window.setTimeout(read, 0);
        },
        () => {}, // the list on screen stays; the next change or reconnect reads again
      );
    }, 150);
  }, [setData, noteArrivals]);

  const apply = useCallback(
    (row: Booking) => {
      generation.current += 1;
      setData((prev) => {
        if (!prev.bookings.some((b) => b.id === row.id)) return prev;
        const status = row.status as BookingStatus;
        const bookings = isActiveStatus(status)
          ? prev.bookings.map(
              (b): ShopBooking =>
                b.id === row.id
                  ? {
                      ...b,
                      status,
                      date: row.date,
                      slot: row.slot.slice(0, 5),
                      note: row.note,
                      confirmed_at: row.confirmed_at,
                      inspection_started_at: row.inspection_started_at,
                      started_at: row.started_at,
                    }
                  : b,
            )
          : prev.bookings.filter((b) => b.id !== row.id);
        return { ...prev, bookings };
      });
      refresh();
    },
    [setData, refresh],
  );

  const shopId = state.status === 'ready' ? state.data.shop.id : null;
  useEffect(() => {
    if (!shopId) return;
    return subscribeRows<Booking>({
      channel: `shop-bookings:${shopId}`,
      table: 'bookings',
      filter: `shop_id=eq.${shopId}`,
      onChange: (payload) => {
        const row = payload.new as Partial<Booking>;
        if (payload.eventType === 'UPDATE' && row.id && row.status && row.date && row.slot) apply(row as Booking);
        else refresh(); // a new request: its service and client details come with a read
      },
      onResync: refresh,
    });
  }, [shopId, apply, refresh]);

  const value = useMemo<ShopBookingsValue>(
    () => ({ state, reload, refresh, apply, isFresh }),
    [state, reload, refresh, apply, isFresh],
  );
  return <ShopBookingsContext.Provider value={value}>{children}</ShopBookingsContext.Provider>;
}
