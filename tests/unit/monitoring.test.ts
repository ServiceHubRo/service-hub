import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildEnvelope,
  buildEvent,
  describeError,
  onlyForeignFrames,
  parseDsn,
  parseStack,
  scrubText,
  scrubUrl,
  sendEvent,
} from '../../supabase/functions/_shared/sentry.ts';

const DSN = 'https://abc123@o42.ingest.de.sentry.io/4507';

describe('parseDsn', () => {
  it('builds the envelope address from a DSN', () => {
    const dsn = parseDsn(DSN)!;
    expect(dsn.publicKey).toBe('abc123');
    expect(dsn.envelopeUrl).toBe(
      'https://o42.ingest.de.sentry.io/api/4507/envelope/?sentry_version=7&sentry_key=abc123&sentry_client=service-hub%2F1.0',
    );
  });

  it('keeps a path prefix and a port (self-hosted, the local stand-in)', () => {
    expect(parseDsn('http://key@127.0.0.1:54398/sentry/1')!.envelopeUrl).toMatch(
      /^http:\/\/127\.0\.0\.1:54398\/sentry\/api\/1\/envelope\/\?/,
    );
  });

  it('refuses anything that is not a DSN', () => {
    for (const bad of [undefined, null, '', '  ', 'not a url', 'https://o42.ingest.sentry.io/4507', 'https://k@host/', 'https://k@host/abc', 'ftp://k@host/1']) {
      expect(parseDsn(bad)).toBeNull();
    }
  });
});

describe('scrubbing', () => {
  it('drops the session an email link carries in the address', () => {
    const url = 'https://service-hub.ro/#access_token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.sig&refresh_token=abc&type=signup';
    expect(scrubUrl(url)).toBe('https://service-hub.ro/');
  });

  it('hides tokens and personal values in the query and the invitation path', () => {
    expect(scrubUrl('https://service-hub.ro/invitatie/9f8e7d6c5b4a?lang=ro')).toBe('https://service-hub.ro/invitatie/[token]?lang=ro');
    expect(scrubUrl('https://x.test/cb?code=123&email=ana%40x.ro&tab=cereri')).toBe(
      'https://x.test/cb?code=%5Bfiltered%5D&email=%5Bfiltered%5D&tab=cereri',
    );
    expect(scrubUrl('https://x.test/s/programari?p=1b2c')).toBe('https://x.test/s/programari?p=1b2c');
  });

  it('replaces emails, Romanian phone numbers and access tokens in text', () => {
    expect(scrubText('duplicate key (email)=(ana.pop+1@gmail.com)')).toBe('duplicate key (email)=([email])');
    expect(scrubText('call 0723 375 248 or +40723375248 or 0723.375.248')).toBe('call [phone] or [phone] or [phone]');
    expect(scrubText('Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl')).toBe('Bearer [token]');
    // Numbers that are not phones stay (amounts, odometer, booking refs).
    expect(scrubText('105400 km, 1250 lei, ref 0712')).toBe('105400 km, 1250 lei, ref 0712');
  });
});

describe('parseStack', () => {
  it('reads Chrome / Deno stacks, oldest call first', () => {
    const stack = [
      'TypeError: Cannot read properties of undefined',
      '    at renderRow (https://service-hub.ro/assets/ShopApp-abc.js:1:2345)',
      '    at async load (https://service-hub.ro/assets/index-def.js:3:44)',
      '    at https://service-hub.ro/assets/index-def.js:9:1',
      '    at Array.map (<anonymous>)',
    ].join('\n');
    const frames = parseStack(stack);
    expect(frames.map((f) => [f.function, f.filename, f.lineno, f.colno])).toEqual([
      ['?', '/assets/index-def.js', 9, 1],
      ['async load', '/assets/index-def.js', 3, 44],
      ['renderRow', '/assets/ShopApp-abc.js', 1, 2345],
    ]);
    expect(frames.every((f) => f.in_app)).toBe(true);

    const deno = parseStack('Error: boom\n    at handle (file:///var/tmp/functions/stripe-webhook/index.ts:150:11)');
    expect(deno[0]).toMatchObject({ function: 'handle', lineno: 150, colno: 11, in_app: true });
  });

  it('reads Firefox / Safari stacks and marks extension frames as not ours', () => {
    const frames = parseStack('go@https://service-hub.ro/assets/a.js:1:2\n@moz-extension://abc/content.js:5:6');
    expect(frames).toHaveLength(2);
    expect(frames[1]).toMatchObject({ function: 'go', lineno: 1, in_app: true });
    expect(frames[0]).toMatchObject({ function: '?', in_app: false });
    expect(onlyForeignFrames(parseStack('x@chrome-extension://id/a.js:1:1'))).toBe(true);
    expect(onlyForeignFrames(frames)).toBe(false);
    expect(parseStack(undefined)).toEqual([]);
  });
});

describe('events', () => {
  it('describes whatever was thrown', () => {
    expect(describeError(new RangeError('bad'))).toMatchObject({ type: 'RangeError', value: 'bad' });
    expect(describeError('plain')).toEqual({ type: 'Error', value: 'plain' });
    // A Supabase error object.
    expect(describeError({ code: '42501', message: 'permission denied for table cars', details: null })).toMatchObject({
      type: 'Error',
      value: '42501 · permission denied for table cars',
    });
    expect(describeError({ a: 1 }).value).toBe('{"a":1}');
  });

  it('builds an event with only the allowed details', () => {
    const error = new Error('insert failed for ana@x.ro');
    const event = buildEvent(
      error,
      { environment: 'deploy-preview', release: 'abc123', tags: { side: 'browser' } },
      {
        tags: { rpc: 'create_booking' },
        extra: { note: 'phone 0723375248' },
        user: { id: 'u-1', role: 'client' },
        url: 'https://service-hub.ro/c/cauta#access_token=eyJabcdefgh.eyJabcdefgh.sig',
        userAgent: 'UA',
        breadcrumbs: [{ timestamp: 1, category: 'navigation', message: '/c/cauta?email=x@y.ro' }],
      },
      1_700_000_000_000,
    );
    expect(event.event_id).toMatch(/^[0-9a-f]{32}$/);
    expect(event).toMatchObject({
      timestamp: 1_700_000_000,
      platform: 'javascript',
      level: 'error',
      environment: 'deploy-preview',
      release: 'abc123',
      tags: { side: 'browser', rpc: 'create_booking' },
      user: { id: 'u-1', role: 'client' },
      request: { url: 'https://service-hub.ro/c/cauta', headers: { 'User-Agent': 'UA' } },
      extra: { note: 'phone [phone]' },
    });
    expect(event.exception.values[0]!.value).toBe('insert failed for [email]');
    expect(event.exception.values[0]!.stacktrace?.frames.length).toBeGreaterThan(0);
    expect(event.breadcrumbs!.values[0]!.message).toBe('/c/cauta?email=[email]');
    expect(JSON.stringify(event)).not.toMatch(/ana@x\.ro|0723375248|access_token/);
  });

  it('wraps the event in an envelope', () => {
    const dsn = parseDsn(DSN)!;
    const event = buildEvent(new Error('x'), { environment: 'production' });
    const lines = buildEnvelope(event, dsn, 0).split('\n');
    expect(lines).toHaveLength(4);
    expect(JSON.parse(lines[0]!)).toEqual({ event_id: event.event_id, sent_at: '1970-01-01T00:00:00.000Z', dsn: DSN });
    expect(JSON.parse(lines[1]!)).toEqual({ type: 'event' });
    expect(JSON.parse(lines[2]!).event_id).toBe(event.event_id);
    expect(lines[3]).toBe('');
  });

  it('sends as plain text and never throws', async () => {
    const dsn = parseDsn(DSN)!;
    const event = buildEvent(new Error('x'), { environment: 'production' });
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 }));
    expect(await sendEvent(event, dsn, fetcher as unknown as typeof fetch)).toBe(true);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(dsn.envelopeUrl);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('text/plain;charset=UTF-8');

    const failing = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await sendEvent(event, dsn, failing as unknown as typeof fetch)).toBe(false);
  });
});

describe('the browser reporter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('sends nothing without VITE_SENTRY_DSN', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', '');
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const m = await import('../../src/lib/monitoring');
    m.captureError(new Error('x'));
    expect(m.monitoringEnabled()).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('sends each error once, with the user and the screens visited, at most 10 per page', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', DSN);
    const bodies: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(String(init.body));
        return new Response('{}');
      }),
    );
    const m = await import('../../src/lib/monitoring');
    m.setMonitoringUser({ id: 'u-7', role: 'shop' });
    m.addBreadcrumb('navigation', '/s/panou');
    const error = new Error('same');
    m.captureError(error, { tags: { rpc: 'confirm_booking' } });
    m.captureError(error);
    expect(bodies).toHaveLength(1);
    const event = JSON.parse(bodies[0]!.split('\n')[2]!);
    expect(event.user).toEqual({ id: 'u-7', role: 'shop' });
    expect(event.tags).toMatchObject({ side: 'browser', rpc: 'confirm_booking' });
    expect(event.breadcrumbs.values[0].message).toBe('/s/panou');

    for (let i = 0; i < 20; i++) m.captureError(new Error(`different ${i}`));
    expect(bodies).toHaveLength(10);
  });

  it('reports uncaught errors but not browser noise or extensions', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', DSN);
    const fetcher = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetcher);
    const m = await import('../../src/lib/monitoring');
    const target = new EventTarget() as unknown as Window;
    m.installGlobalHandlers(target);

    target.dispatchEvent(new ErrorEvent('error', { message: 'ResizeObserver loop limit exceeded' }));
    const ext = new Error('from an extension');
    ext.stack = 'Error: from an extension\n    at x (chrome-extension://abc/content.js:1:1)';
    target.dispatchEvent(new ErrorEvent('error', { error: ext, message: ext.message }));
    const rpc = new Error('day_full');
    rpc.name = 'RpcError';
    const unhandledRpc = new Event('unhandledrejection') as Event & { reason: unknown };
    unhandledRpc.reason = rpc;
    target.dispatchEvent(unhandledRpc);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValueOnce(false);
    target.dispatchEvent(new ErrorEvent('error', { error: new TypeError('Failed to fetch'), message: 'Failed to fetch' }));
    expect(fetcher).not.toHaveBeenCalled();

    target.dispatchEvent(new ErrorEvent('error', { error: new Error('real'), message: 'real' }));
    const rejection = new Event('unhandledrejection') as Event & { reason: unknown };
    rejection.reason = new Error('rejected');
    target.dispatchEvent(rejection);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
