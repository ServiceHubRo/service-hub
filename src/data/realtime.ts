import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { supabase } from './supabase';

let sequence = 0;

/**
 * Live row changes (CLAUDE.md §6.9): Supabase Realtime streams inserts and updates of one table,
 * filtered to the caller's rows and checked against the same RLS as a normal read. Each time the
 * server confirms it is streaming the table — the first time, and again after the connection
 * dropped and came back — `onResync` asks the screen to reload quietly: changes made before that
 * (while the first read was on its way, or while offline) were not streamed.
 */
export function subscribeRows<Row extends Record<string, unknown>>(options: {
  /** Names the screen and user, e.g. `client-bookings:<uid>` (a counter is added to it). */
  channel: string;
  table: string;
  /** PostgREST-style filter, e.g. `client_id=eq.<uid>`; none for the admin's platform-wide lists. */
  filter?: string;
  onChange: (payload: RealtimePostgresChangesPayload<Row>) => void;
  onResync: () => void;
}): () => void {
  const client = supabase;
  if (!client) return () => {};
  // supabase-js hands back a channel of the same name while an earlier one is still closing, and
  // that one cannot take new listeners; a fresh name per subscription avoids it (leaving and
  // quickly coming back to a screen, React's double mount in development).
  sequence += 1;
  const channel = client
    .channel(`${options.channel}:${sequence}`)
    .on<Row>(
      'postgres_changes',
      { event: '*', schema: 'public', table: options.table, ...(options.filter ? { filter: options.filter } : {}) },
      (payload) => options.onChange(payload),
    )
    // "SUBSCRIBED" only means the channel was joined; database changes flow from the moment the
    // server sends this message (seconds later on a cold server), and earlier ones are lost.
    .on('system', {}, (message: { extension?: string; status?: string }) => {
      if (message.extension === 'postgres_changes' && message.status === 'ok') options.onResync();
    })
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}
