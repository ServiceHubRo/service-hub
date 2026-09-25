import { describe, expect, it } from 'vitest';
import {
  cancelState,
  currentQuote,
  decisionKind,
  quotesWaiting,
  reviewPrompt,
  reviewState,
  selectedTotal,
  type Quote,
  type QuoteItem,
} from '../../src/lib/clientBookings';
import { checkOdometer, parseOdometer } from '../../src/lib/validators';

// 2026-10-14 09:30 in Bucharest (UTC+3 in October).
const NOW = new Date('2026-10-14T06:30:00Z');

function item(id: string, price: number, approved: boolean | null = null): QuoteItem {
  return { id, position: Number(id.replace(/\D/g, '')) || 1, name: `Poziția ${id}`, price, approved };
}

function quote(id: string, version: number, status: Quote['status'], items: QuoteItem[] = []): Quote {
  return {
    id,
    version,
    status,
    note: null,
    inspection_fee: 50,
    total_sent: items.reduce((s, i) => s + i.price, 0),
    total_approved: null,
    sent_at: '2026-10-13T08:00:00Z',
    expires_at: '2026-10-16T08:00:00Z',
    decided_at: null,
    items,
  };
}

describe('the quote a client booking shows', () => {
  const history = [
    quote('q1', 1, 'superseded'),
    quote('q2', 2, 'sent'),
    quote('q0', 1, 'withdrawn'),
  ];

  it('waiting: the version still out, never a replaced or withdrawn one', () => {
    expect(currentQuote('quote_sent', history)?.id).toBe('q2');
  });

  it('after the decision: the accepted version, through the job and after it', () => {
    const decided = [quote('q1', 1, 'superseded'), quote('q2', 2, 'partially_accepted')];
    for (const status of ['approved', 'in_progress', 'done'] as const) expect(currentQuote(status, decided)?.id).toBe('q2');
  });

  it('refused and expired quotes stay on their bookings; nothing before a quote', () => {
    expect(currentQuote('quote_refused', [quote('q1', 1, 'refused')])?.id).toBe('q1');
    expect(currentQuote('expired', [quote('q1', 1, 'expired')])?.id).toBe('q1');
    expect(currentQuote('in_inspection', [quote('q1', 1, 'withdrawn')])).toBeNull();
    expect(currentQuote('confirmed', [])).toBeNull();
  });
});

describe('partial approval (P15c)', () => {
  const items = [item('i1', 280), item('i2', 99.9), item('i3', 0.1)];

  it('the total follows the ticked lines, in bani (no float drift)', () => {
    expect(selectedTotal(items, new Set(['i1', 'i2', 'i3']))).toBe(380);
    expect(selectedTotal(items, new Set(['i2', 'i3']))).toBe(100);
    expect(selectedTotal(items, new Set())).toBe(0);
  });

  it('all lines → Accept; some → Accept selectate; none → only a refusal', () => {
    expect(decisionKind(items, new Set(['i1', 'i2', 'i3']))).toBe('all');
    expect(decisionKind(items, new Set(['i1']))).toBe('some');
    expect(decisionKind(items, new Set())).toBe('none');
  });

  it('the tab badge counts quotes waiting for a decision', () => {
    expect(quotesWaiting([{ status: 'quote_sent' }, { status: 'approved' }, { status: 'quote_sent' }])).toBe(2);
  });
});

describe('client cancellation (P15c)', () => {
  const at = (status: 'pending' | 'confirmed' | 'in_inspection', date: string, slot: string) => ({ status, date, slot });

  it('a request can always be cancelled', () => {
    expect(cancelState(at('pending', '2026-10-14', '10:00:00'), 24, NOW)).toBe('allowed');
  });

  it('a confirmed booking: until the deadline before its time, then "contact the shop"', () => {
    // 2 hours before 12:00 is 10:00; now is 09:30.
    expect(cancelState(at('confirmed', '2026-10-14', '12:00:00'), 2, NOW)).toBe('allowed');
    expect(cancelState(at('confirmed', '2026-10-14', '11:00:00'), 2, NOW)).toBe('deadline_passed');
    expect(cancelState(at('confirmed', '2026-10-15', '09:00:00'), 24, NOW)).toBe('deadline_passed');
    expect(cancelState(at('confirmed', '2026-10-15', '10:00:00'), 24, NOW)).toBe('allowed');
  });

  it('no deadline set (0 hours): always allowed while confirmed', () => {
    expect(cancelState(at('confirmed', '2026-10-14', '09:00:00'), 0, NOW)).toBe('allowed');
  });

  it('never once the car is in the workshop', () => {
    expect(cancelState(at('in_inspection', '2026-10-20', '10:00:00'), 2, NOW)).toBe('not_allowed');
  });
});

describe('reviews (once, within the window)', () => {
  const done = (doneAt: string | null) => ({ status: 'done' as const, done_at: doneAt });

  it('open after completion, "sent" once written, closed after the window', () => {
    expect(reviewState(done('2026-10-10T10:00:00Z'), false, 60, NOW)).toBe('open');
    expect(reviewState(done('2026-10-10T10:00:00Z'), true, 60, NOW)).toBe('sent');
    expect(reviewState(done('2026-08-01T10:00:00Z'), false, 60, NOW)).toBe('closed');
  });

  it('nothing for a job that is not finished', () => {
    expect(reviewState({ status: 'in_progress', done_at: null }, false, 60, NOW)).toBeNull();
  });

  it('Caută asks about the most recent job that can still be reviewed (T19d)', () => {
    const job = (id: string, doneAt: string | null, review: { id: string } | null = null, status: 'done' | 'confirmed' = 'done') => ({
      id,
      status,
      done_at: doneAt,
      review,
    });
    const older = job('older', '2026-10-01T10:00:00Z');
    const newer = job('newer', '2026-10-10T10:00:00Z');
    expect(reviewPrompt([older, newer], 60, NOW)).toBe(newer);
    expect(reviewPrompt([job('newer', '2026-10-10T10:00:00Z', { id: 'r' }), older], 60, NOW)).toBe(older);
    expect(reviewPrompt([job('old', '2026-08-01T10:00:00Z'), job('active', null, null, 'confirmed')], 60, NOW)).toBeNull();
    expect(reviewPrompt([], 60, NOW)).toBeNull();
  });
});

describe('odometer (ARCHITECTURE §7)', () => {
  it('reads km with or without grouping marks', () => {
    expect(parseOdometer('105400')).toBe(105400);
    expect(parseOdometer('105.400')).toBe(105400);
    expect(parseOdometer('105 400')).toBe(105400);
    expect(parseOdometer('105,400')).toBe(105400);
    expect(parseOdometer('')).toBeNull();
    expect(parseOdometer('105a')).toBeNull();
    expect(parseOdometer('-5')).toBeNull();
  });

  it('checks in the database order: required, range, lower, jump', () => {
    expect(checkOdometer('', 105400)).toEqual({ ok: false, error: 'odometer_required' });
    expect(checkOdometer('99', null)).toEqual({ ok: false, error: 'odometer_invalid' });
    expect(checkOdometer('2000001', null)).toEqual({ ok: false, error: 'odometer_invalid' });
    expect(checkOdometer('98000', 105400)).toEqual({ ok: false, error: 'odometer_lower', previous: 105400 });
    expect(checkOdometer('105400', 105400)).toEqual({ ok: true, km: 105400, jump: null });
    expect(checkOdometer('155400', 105400)).toEqual({ ok: true, km: 155400, jump: null });
    expect(checkOdometer('155401', 105400)).toEqual({ ok: true, km: 155401, jump: 50001 });
  });

  it('a first reading accepts any value in range', () => {
    expect(checkOdometer('1.999.999', null)).toEqual({ ok: true, km: 1999999, jump: null });
  });
});
