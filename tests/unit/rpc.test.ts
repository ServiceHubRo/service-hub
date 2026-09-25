import { beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '../../src/i18n/en';
import { ro } from '../../src/i18n/ro';

const rpc = vi.fn();
vi.mock('../../src/data/supabase', () => ({ supabase: { rpc: (...args: unknown[]) => rpc(...args) } }));

const {
  RPC_ERROR_CODES,
  RpcError,
  completeJob,
  createBooking,
  decideQuote,
  getAvailability,
  lastOdometerForBooking,
  rpcErrorMessage,
  searchShops,
  toRpcError,
} = await import('../../src/data/rpc');

/** Every code raised with public.fail('…') in the migrations. */
function codesInMigrations(): string[] {
  const files = import.meta.glob('../../supabase/migrations/*.sql', { query: '?raw', import: 'default', eager: true });
  const codes = new Set<string>();
  for (const sql of Object.values(files) as string[]) {
    for (const m of sql.matchAll(/public\.fail\('([a-z_]+)'/g)) codes.add(m[1]!);
  }
  return [...codes].sort();
}

// What PostgREST returns for `raise exception using message = code, detail = json`.
const pgError = (message: string, details = '{}') => ({ code: 'P0001', message, details, hint: null });

describe('error codes', () => {
  it('RPC_ERROR_CODES lists exactly the codes the database raises', () => {
    expect([...RPC_ERROR_CODES].sort()).toEqual(codesInMigrations());
  });

  it('every code has a Romanian and an English message', () => {
    for (const code of RPC_ERROR_CODES) {
      for (const lang of ['ro', 'en'] as const) {
        const text = rpcErrorMessage(lang, pgError(code));
        expect(text, `${lang} ${code}`).not.toMatch(/^rpcError\./);
        expect(text, `${lang} ${code}`).not.toBe('');
      }
    }
  });

  it('messages never end with an exclamation mark', () => {
    for (const [key, value] of [...Object.entries(ro), ...Object.entries(en)]) {
      if (key.startsWith('rpcError.')) expect(value, key).not.toContain('!');
    }
  });
});

describe('toRpcError', () => {
  it('keeps the code and parses the parameters', () => {
    const e = toRpcError(pgError('odometer_lower', '{"previous":105400}'));
    expect(e).toBeInstanceOf(RpcError);
    expect(e.code).toBe('odometer_lower');
    expect(e.params).toEqual({ previous: 105400 });
  });

  it('survives missing or broken details', () => {
    expect(toRpcError({ message: 'day_full' }).params).toEqual({});
    expect(toRpcError(pgError('day_full', 'not json')).params).toEqual({});
  });

  it('never exposes a raw database error', () => {
    const e = toRpcError({ message: 'duplicate key value violates unique constraint "x"', code: '23505' });
    expect(e.code).toBe('unknown');
    expect(rpcErrorMessage('ro', e)).toBe('Ceva n-a mers. Încearcă din nou.');
  });

  it('recognizes a network failure', () => {
    expect(toRpcError(new TypeError('Failed to fetch')).code).toBe('network');
    expect(toRpcError({ message: 'Load failed' }).code).toBe('network');
    expect(rpcErrorMessage('en', new TypeError('Failed to fetch'))).toBe(en['action.error']);
  });
});

describe('rpcErrorMessage', () => {
  it('formats odometer values in each language', () => {
    expect(rpcErrorMessage('ro', pgError('odometer_lower', '{"previous":105400}'))).toBe(
      'Ultima valoare înregistrată a fost 105.400 km. Verifică cifra.',
    );
    expect(rpcErrorMessage('en', pgError('odometer_lower', '{"previous":105400}'))).toBe(
      'The last recorded reading was 105,400 km. Check the number.',
    );
    expect(rpcErrorMessage('ro', pgError('odometer_jump', '{"previous":105400,"diff":61000}'))).toBe(
      'Sunt 61.000 km în plus față de ultima lucrare. Confirmi?',
    );
  });

  it('uses Romanian plurals for hours and days', () => {
    expect(rpcErrorMessage('ro', pgError('too_soon', '{"hours":2}'))).toContain('cel puțin 2 ore înainte');
    expect(rpcErrorMessage('ro', pgError('too_soon', '{"hours":24}'))).toContain('cel puțin 24 de ore înainte');
    expect(rpcErrorMessage('ro', pgError('cancel_deadline_passed', '{"hours":1}'))).toContain('1 oră');
    expect(rpcErrorMessage('en', pgError('too_soon', '{"hours":1}'))).toContain('at least 1 hour notice');
    expect(rpcErrorMessage('ro', pgError('review_window_closed', '{"days":60}'))).toContain('60 de zile');
  });

  it('names limits and quote lines', () => {
    expect(rpcErrorMessage('ro', pgError('limit_active_shop', '{"limit":3}'))).toBe(
      'Ai deja 3 programări active la acest service.',
    );
    expect(rpcErrorMessage('en', pgError('quote_item_invalid', '{"position":2}'))).toBe(
      'Line 2 needs a name and a valid price.',
    );
    expect(rpcErrorMessage('en', pgError('quote_item_invalid'))).toBe('Check the quote lines.');
  });
});

describe('calls', () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it('createBooking sends a garage car by id', async () => {
    rpc.mockResolvedValue({ data: { id: 'b1', status: 'pending' }, error: null });
    const booking = await createBooking(
      { shopId: 's1', serviceId: 'ulei', date: '2026-10-14', slot: '09:00', car: { carId: 'c1' }, note: 'Lichide' },
      'r1',
    );
    expect(booking).toEqual({ id: 'b1', status: 'pending' });
    expect(rpc).toHaveBeenCalledWith('create_booking', {
      p_shop_id: 's1',
      p_service_id: 'ulei',
      p_date: '2026-10-14',
      p_slot: '09:00',
      p_request_id: 'r1',
      p_car_id: 'c1',
      p_note: 'Lichide',
    });
  });

  it('createBooking sends a typed car and the save choice', async () => {
    rpc.mockResolvedValue({ data: { id: 'b2' }, error: null });
    await createBooking(
      {
        shopId: 's1',
        serviceId: 'ulei',
        date: '2026-10-14',
        slot: '09:00',
        car: { car: { make: 'Dacia', model: 'Logan', plate: 'BV 01 ABC' }, saveCar: true },
      },
      'r2',
    );
    expect(rpc.mock.calls[0]![1]).toMatchObject({
      p_car: { make: 'Dacia', model: 'Logan', plate: 'BV 01 ABC' },
      p_save_car: true,
    });
    expect(rpc.mock.calls[0]![1]).not.toHaveProperty('p_car_id');
  });

  it('throws an RpcError with the code the database raised', async () => {
    rpc.mockResolvedValue({ data: null, error: pgError('slot_full') });
    await expect(
      createBooking({ shopId: 's', serviceId: 'ulei', date: '2026-10-14', slot: '09:00', car: { carId: 'c' } }, 'r'),
    ).rejects.toMatchObject({ code: 'slot_full' });
  });

  it('turns a rejected fetch into a network error', async () => {
    rpc.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(decideQuote('b', 'q', ['i1'], 'r')).rejects.toMatchObject({ code: 'network' });
  });

  it('passes the quote version the client answered', async () => {
    rpc.mockResolvedValue({ data: { id: 'b', status: 'approved' }, error: null });
    await decideQuote('b', 'q2', ['i1', 'i3'], 'r');
    expect(rpc).toHaveBeenCalledWith('decide_quote', {
      p_booking_id: 'b',
      p_quote_id: 'q2',
      p_approved_item_ids: ['i1', 'i3'],
      p_request_id: 'r',
    });
  });

  it('completeJob sends the confirmation flag only when given', async () => {
    rpc.mockResolvedValue({ data: { id: 'b', status: 'done' }, error: null });
    await completeJob({ bookingId: 'b', odometer: 155401, confirmJump: true }, 'r');
    expect(rpc.mock.calls[0]![1]).toMatchObject({ p_odometer: 155401, p_confirm_jump: true });
    await completeJob({ bookingId: 'b', odometer: 1000 }, 'r2');
    expect(rpc.mock.calls[1]![1]).toMatchObject({ p_confirm_jump: false });
  });

  it('reads availability, search results and the last odometer', async () => {
    rpc.mockResolvedValueOnce({ data: { days: [{ date: '2026-10-14', bookable: true, places_left: 3, reason: null }], slots: [] }, error: null });
    expect((await getAvailability('s', { days: 12 })).days[0]!.places_left).toBe(3);
    expect(rpc.mock.calls[0]![1]).toMatchObject({ p_shop_id: 's', p_days: 12 });

    rpc.mockResolvedValueOnce({ data: [{ shop_id: 's', name: 'Atelier Demo' }], error: null });
    expect((await searchShops({ q: 'frane', sort: 'rating' }))[0]!.name).toBe('Atelier Demo');
    expect(rpc.mock.calls[1]![1]).toMatchObject({ p_q: 'frane', p_sort: 'rating' });

    rpc.mockResolvedValueOnce({ data: null, error: null });
    expect(await lastOdometerForBooking('b')).toBeNull();
  });
});

describe('admin form errors (T16a)', () => {
  it('names the field the database refused', () => {
    expect(rpcErrorMessage('ro', pgError('field_invalid', '{"field":"iban"}'))).toBe('Verifică câmpul „IBAN”: valoarea nu e validă.');
    expect(rpcErrorMessage('en', pgError('field_invalid', '{"field":"daily_capacity"}'))).toBe(
      'Check the “Cars per day” field: the value is not valid.',
    );
    expect(rpcErrorMessage('ro', pgError('field_invalid', '{"field":"unknown"}'))).toBe(
      'O valoare nu e validă. Verifică datele și încearcă din nou.',
    );
  });
});
