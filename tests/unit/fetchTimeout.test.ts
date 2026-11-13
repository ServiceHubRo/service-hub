import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toRpcError } from '../../src/data/rpc';
import { API_TIMEOUT_MS, fetchWithTimeout, TIMEOUT_MESSAGE, timeoutFor } from '../../src/lib/fetchTimeout';

const API = 'https://abc.supabase.co';

/** A fetch that never answers on its own, and fails as a browser does when its signal aborts. */
function hangingFetch() {
  const calls: { url: string; signal: AbortSignal | null | undefined }[] = [];
  const base = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), signal: init?.signal });
    return new Promise<Response>((_resolve, reject) => {
      if (init?.signal?.aborted) reject(new DOMException('The operation was aborted.', 'AbortError'));
      init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
    });
  });
  return { base: base as unknown as typeof fetch, calls };
}

describe('timeoutFor (A8)', () => {
  it('limits the database API and sign-in, not files or Edge Functions', () => {
    expect(timeoutFor(`${API}/rest/v1/rpc/list_shop_bookings`)).toBe(API_TIMEOUT_MS);
    expect(timeoutFor(`${API}/rest/v1/cars?select=*`)).toBe(API_TIMEOUT_MS);
    expect(timeoutFor(`${API}/auth/v1/token?grant_type=refresh_token`)).toBe(API_TIMEOUT_MS);
    expect(timeoutFor(`${API}/storage/v1/object/shop-photos/a.jpg`)).toBeNull();
    expect(timeoutFor(`${API}/functions/v1/job-document`)).toBeNull();
  });
});

describe('fetchWithTimeout (A8)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a database request with no answer fails like a lost connection after 30 s', async () => {
    const { base } = hangingFetch();
    const request = fetchWithTimeout(base)(`${API}/rest/v1/rpc/confirm_booking`, { method: 'POST' });
    const settled = vi.fn();
    request.then(settled, settled);

    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS - 1);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(request).rejects.toThrow(TypeError);
    await expect(request).rejects.toThrow(TIMEOUT_MESSAGE);
  });

  it('the screens read it as a lost connection: the network message and „Încearcă din nou”', () => {
    // supabase-js hands a failed fetch back as { message: `${name}: ${message}` }.
    expect(toRpcError({ message: `TypeError: ${TIMEOUT_MESSAGE}`, details: '', hint: '', code: '' }).code).toBe('network');
    expect(toRpcError(new TypeError(TIMEOUT_MESSAGE)).code).toBe('network');
  });

  it('an answer in time passes through unchanged, and nothing fires later', async () => {
    const response = new Response('{}', { status: 200 });
    const base = vi.fn(() => Promise.resolve(response)) as unknown as typeof fetch;
    const result = await fetchWithTimeout(base)(`${API}/rest/v1/rpc/x`, { method: 'POST', body: '{}' });
    expect(result).toBe(response);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the method, headers and body of the request', async () => {
    const base = vi.fn<typeof fetch>(() => Promise.resolve(new Response('{}')));
    await fetchWithTimeout(base)(`${API}/rest/v1/rpc/x`, {
      method: 'POST',
      headers: { apikey: 'k' },
      body: '{"a":1}',
    });
    const init = base.mock.calls[0]![1]!;
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ apikey: 'k' });
    expect(init.body).toBe('{"a":1}');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('uploads and Edge Functions are not limited: the request goes out exactly as given', async () => {
    const { base, calls } = hangingFetch();
    const own = new AbortController();
    void fetchWithTimeout(base)(`${API}/storage/v1/object/fleet-files/x.png`, { method: 'POST', signal: own.signal });
    void fetchWithTimeout(base)(`${API}/functions/v1/job-document`, { method: 'POST' });
    expect(calls[0]!.signal).toBe(own.signal);
    expect(calls[1]!.signal).toBeUndefined();
    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS * 4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("the caller's own cancel still cancels, as itself and not as a timeout", async () => {
    const { base } = hangingFetch();
    const own = new AbortController();
    const request = fetchWithTimeout(base)(`${API}/rest/v1/cars`, { signal: own.signal });
    own.abort();
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a signal already canceled cancels at once', async () => {
    const { base } = hangingFetch();
    const own = new AbortController();
    own.abort();
    await expect(fetchWithTimeout(base)(`${API}/auth/v1/user`, { signal: own.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
