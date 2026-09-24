import { describe, expect, it } from 'vitest';
import { reviewSummary } from '../../src/data/reviews';
import { en } from '../../src/i18n/en';
import { ro } from '../../src/i18n/ro';
import {
  counterpartName,
  formatDayHeading,
  formatListTime,
  isOwnSide,
  mergeMessages,
  systemMessageKeys,
  systemMessageText,
} from '../../src/lib/messages';
import { unreadThreads } from '../../src/screens/messages/threadsContext';

/** Event codes the migrations write as automatic messages (post_booking_event and decide_quote). */
function eventsInMigrations(): string[] {
  const files = import.meta.glob('../../supabase/migrations/*.sql', { query: '?raw', import: 'default', eager: true });
  const events = new Set<string>();
  for (const sql of Object.values(files) as string[]) {
    for (const m of sql.matchAll(/post_booking_event\([^,]+,\s*'(\w+)'/g)) events.add(m[1]!);
    for (const m of sql.matchAll(/v_event\s*:=[^;]*/g)) for (const q of m[0].matchAll(/'(quote_\w+)'/g)) events.add(q[1]!);
  }
  return [...events].sort();
}

describe('automatic messages', () => {
  it('have a text for every event the database writes, on both sides, in both languages', () => {
    const keys = new Set(systemMessageKeys());
    const events = eventsInMigrations();
    expect(events.length).toBeGreaterThan(15);
    for (const event of events) {
      for (const side of ['client', 'shop']) {
        const key = `sysmsg.${event}.${side}`;
        expect(keys.has(key as never), key).toBe(true);
        expect(ro[key as keyof typeof ro], key).toBeTruthy();
        expect(en[key as keyof typeof en], key).toBeTruthy();
      }
    }
  });

  it('read from the reader side, in the reader language', () => {
    const params = { ref: 'P-000123', by: 'shop', date: '2026-10-14', slot: '10:00' };
    expect(systemMessageText('ro', 'client', 'booking_confirmed', params)).toBe('Programarea P-000123 e confirmată: Mie 14 oct, 10:00.');
    expect(systemMessageText('ro', 'shop', 'booking_confirmed', params)).toBe('Ai confirmat programarea P-000123: Mie 14 oct, 10:00.');
    expect(systemMessageText('en', 'client', 'booking_confirmed', params)).toBe('Booking P-000123 is confirmed: Wed, Oct 14, 10:00.');
  });

  it('carry amounts, reasons and the inspection fee', () => {
    expect(systemMessageText('ro', 'client', 'quote_sent', { ref: 'P-1', total: 1250 })).toBe(
      'Ai primit devizul pentru P-1: 1.250 lei. Îl poți accepta sau refuza în Programări.',
    );
    expect(systemMessageText('en', 'shop', 'quote_partially_accepted', { ref: 'P-1', total: 430, total_sent: 580 })).toBe(
      'The customer accepted part of the quote for P-1: 430 RON of 580 RON.',
    );
    expect(systemMessageText('ro', 'client', 'booking_cancelled_shop', { ref: 'P-1', reason: 'Lipsă piese' })).toBe(
      'Service-ul a anulat programarea P-1. Motiv: Lipsă piese',
    );
    expect(systemMessageText('ro', 'shop', 'quote_refused', { ref: 'P-1', inspection_fee: 100 })).toBe(
      'Clientul a refuzat devizul pentru P-1. Taxă de constatare: 100 lei.',
    );
    // No fee: the refusal does not mention one.
    expect(systemMessageText('ro', 'client', 'quote_refused', { ref: 'P-1', inspection_fee: 0 })).toBe('Ai refuzat devizul pentru P-1.');
  });

  it('fall back to a generic text for an unknown event', () => {
    expect(systemMessageText('ro', 'client', 'something_new', { ref: 'P-9' })).toBe('Actualizare la programarea P-9.');
    expect(systemMessageText('en', 'shop', null, null)).toBe('Update on booking .');
  });
});

describe('isOwnSide', () => {
  const client = 'c1';
  it('client: own messages and the automatic messages the client caused', () => {
    expect(isOwnSide({ kind: 'user', sender_id: 'c1', params: null }, 'client', client)).toBe(true);
    expect(isOwnSide({ kind: 'user', sender_id: 's1', params: null }, 'client', client)).toBe(false);
    expect(isOwnSide({ kind: 'system', sender_id: null, params: { by: 'client' } }, 'client', client)).toBe(true);
    expect(isOwnSide({ kind: 'system', sender_id: null, params: { by: 'shop' } }, 'client', client)).toBe(false);
  });
  it('shop: every member and the automatic messages the shop caused', () => {
    expect(isOwnSide({ kind: 'user', sender_id: 's1', params: null }, 'shop', client)).toBe(true);
    expect(isOwnSide({ kind: 'user', sender_id: 's2', params: null }, 'shop', client)).toBe(true);
    expect(isOwnSide({ kind: 'user', sender_id: 'c1', params: null }, 'shop', client)).toBe(false);
    expect(isOwnSide({ kind: 'system', sender_id: null, params: { by: 'shop' } }, 'shop', client)).toBe(true);
    expect(isOwnSide({ kind: 'system', sender_id: null, params: { by: 'system' } }, 'shop', client)).toBe(false);
  });
});

describe('message lists', () => {
  it('merge by id in time order, whatever the timestamp spelling', () => {
    const a = { id: 'a', created_at: '2026-10-14T08:00:00.000000+00:00' };
    const b = { id: 'b', created_at: '2026-10-14 08:05:00+00' };
    const c = { id: 'c', created_at: '2026-10-14T08:02:00Z' };
    expect(mergeMessages([a, b], [c, a]).map((m) => m.id)).toEqual(['a', 'c', 'b']);
  });

  it('show today as a time, yesterday as a word, older as a date (Bucharest)', () => {
    const now = new Date('2026-10-14T21:30:00Z'); // 00:30 on Oct 15 in Bucharest
    expect(formatListTime('ro', '2026-10-14T21:10:00Z', now)).toBe('00:10');
    expect(formatListTime('ro', '2026-10-14T20:50:00Z', now)).toBe('Ieri');
    expect(formatListTime('en', '2026-10-12T09:00:00Z', now)).toBe('Mon, Oct 12');
    expect(formatDayHeading('en', '2026-10-15', now)).toBe('Today');
  });

  it('name the other side; a deleted client has a label', () => {
    const thread = { shop_name: 'Atelier Demo', client_name: '  ' };
    expect(counterpartName('client', thread, 'Cont șters')).toBe('Atelier Demo');
    expect(counterpartName('shop', thread, 'Cont șters')).toBe('Cont șters');
    expect(counterpartName('shop', { ...thread, client_name: 'Ana Marin' }, 'x')).toBe('Ana Marin');
  });

  it('count conversations with unread messages for the tab badge', () => {
    expect(unreadThreads([{ unread: 0 }, { unread: 3 }, { unread: 1 }] as never)).toBe(2);
  });
});

describe('reviewSummary', () => {
  it('averages the reviews that count, without the removed ones', () => {
    expect(reviewSummary([])).toEqual({ average: null, count: 0 });
    expect(
      reviewSummary([
        { rating: 5, removed_at: null },
        { rating: 4, removed_at: null },
        { rating: 1, removed_at: '2026-10-01T00:00:00Z' },
      ]),
    ).toEqual({ average: 4.5, count: 2 });
  });
});
