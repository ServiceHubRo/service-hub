import { afterEach, describe, expect, it } from 'vitest';
import { afterSignIn } from '../../src/app/roles';
import { AuthFailure, authErrorMessage, isRetryable, toAuthFailure } from '../../src/data/auth';
import { RpcError } from '../../src/data/rpc';
import { emailsSentLastHour, recordEmailSent, secondsUntilNext } from '../../src/lib/cooldown';
import { parseMarkdown, parseInline } from '../../src/lib/markdown';
import { looksLikeEmail, passwordStrength } from '../../src/lib/password';
import {
  authStorage,
  inactiveTooLong,
  INACTIVITY_LIMIT_MS,
  LAST_SEEN_KEY,
  markSeen,
  rememberMe,
  setRememberMe,
} from '../../src/lib/remember';

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('Ține-mă minte (ARCHITECTURE §15)', () => {
  it('is ticked by default', () => {
    expect(rememberMe()).toBe(true);
  });

  it('ticked: the session goes to localStorage and survives the browser', () => {
    setRememberMe(true);
    authStorage.setItem('sb-token', 'abc');
    expect(localStorage.getItem('sb-token')).toBe('abc');
    expect(sessionStorage.getItem('sb-token')).toBeNull();
    expect(authStorage.getItem('sb-token')).toBe('abc');
  });

  it('unticked: the session goes to sessionStorage only', () => {
    setRememberMe(false);
    authStorage.setItem('sb-token', 'abc');
    expect(sessionStorage.getItem('sb-token')).toBe('abc');
    expect(localStorage.getItem('sb-token')).toBeNull();
    expect(authStorage.getItem('sb-token')).toBe('abc');
  });

  it('switching modes never leaves a copy in the other storage', () => {
    setRememberMe(true);
    authStorage.setItem('sb-token', 'one');
    setRememberMe(false);
    authStorage.setItem('sb-token', 'two');
    expect(localStorage.getItem('sb-token')).toBeNull();
    authStorage.removeItem('sb-token');
    expect(sessionStorage.getItem('sb-token')).toBeNull();
  });

  it('a session unused for 30 days on this device ends', () => {
    const now = Date.now();
    expect(inactiveTooLong(now)).toBe(false); // never seen
    markSeen(now - INACTIVITY_LIMIT_MS + 60_000);
    expect(inactiveTooLong(now)).toBe(false);
    localStorage.setItem(LAST_SEEN_KEY, String(now - INACTIVITY_LIMIT_MS - 60_000));
    expect(inactiveTooLong(now)).toBe(true);
  });
});

describe('auth errors are specific and translated', () => {
  const cases: [unknown, string][] = [
    [{ code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' }, 'Email sau parolă greșită.'],
    [{ code: 'email_not_confirmed', status: 400 }, 'Confirmă mai întâi adresa de email.'],
    [{ code: 'user_already_exists', status: 422 }, 'Există deja un cont cu acest email. Intră în cont sau resetează parola.'],
    [{ code: 'over_email_send_rate_limit', status: 429, message: 'email rate limit exceeded' }, 'Prea multe încercări. Încearcă peste o oră.'],
    [
      { code: 'over_request_rate_limit', status: 429, message: 'For security purposes, you can only request this after 42 seconds.' },
      'Prea multe încercări. Încearcă din nou peste 42 secunde.',
    ],
    [{ name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 }, 'Nu s-a putut trimite. Verifică internetul și încearcă din nou.'],
    [new AuthFailure('wrong_current_password'), 'Parola actuală nu e corectă.'],
    [{ code: 'something_new', status: 500 }, 'Ceva n-a mers. Încearcă din nou.'],
  ];
  it.each(cases)('%j', (error, text) => {
    expect(authErrorMessage('ro', error)).toBe(text);
  });

  it('English too', () => {
    expect(authErrorMessage('en', { code: 'invalid_credentials' })).toBe('Wrong email or password.');
  });

  it('database refusals from delete-account keep their own message', () => {
    expect(authErrorMessage('ro', new RpcError('account_has_active_bookings'))).toMatch(/programări active/);
    expect(authErrorMessage('en', new RpcError('shop_has_active_bookings'))).toMatch(/active bookings/);
  });

  it('only network trouble offers "Încearcă din nou"', () => {
    expect(isRetryable({ name: 'AuthRetryableFetchError' })).toBe(true);
    expect(isRetryable({ code: 'invalid_credentials' })).toBe(false);
    expect(isRetryable(new RpcError('network'))).toBe(true);
    expect(isRetryable(new RpcError('account_has_active_bookings'))).toBe(false);
  });

  it('maps session errors', () => {
    expect(toAuthFailure({ name: 'AuthSessionMissingError' }).code).toBe('session_missing');
    expect(toAuthFailure({ code: 'refresh_token_not_found' }).code).toBe('session_missing');
  });
});

describe('passwords and emails', () => {
  it('strength hint in words, only "short" blocks', () => {
    expect(passwordStrength('abc')).toBe('short');
    expect(passwordStrength('abcdefgh')).toBe('weak');
    expect(passwordStrength('abcdefg1')).toBe('medium');
    expect(passwordStrength('Abcdefg1!x')).toBe('strong');
    expect(passwordStrength('correct horse battery')).toBe('strong'); // a long passphrase
  });

  it('emails', () => {
    expect(looksLikeEmail('eduard@gmail.com')).toBe(true);
    expect(looksLikeEmail(' adresa+service@gmail.com ')).toBe(true);
    expect(looksLikeEmail('eduard@gmail')).toBe(false);
    expect(looksLikeEmail('eduard gmail.com')).toBe(false);
  });
});

describe('email pacing', () => {
  it('"Retrimite" waits 60 s after a send, per address', () => {
    const now = 1_000_000_000;
    expect(secondsUntilNext('signup', 'a@b.ro', 60, now)).toBe(0);
    recordEmailSent('signup', 'A@b.ro ', now);
    expect(secondsUntilNext('signup', 'a@b.ro', 60, now + 1000)).toBe(59);
    expect(secondsUntilNext('signup', 'other@b.ro', 60, now + 1000)).toBe(0);
    expect(secondsUntilNext('signup', 'a@b.ro', 60, now + 61_000)).toBe(0);
  });

  it('counts reset links in the last hour', () => {
    const now = 2_000_000_000;
    recordEmailSent('reset', 'a@b.ro', now - 2 * 60 * 60 * 1000);
    recordEmailSent('reset', 'a@b.ro', now - 60_000);
    recordEmailSent('reset', 'a@b.ro', now);
    expect(emailsSentLastHour('reset', 'a@b.ro', now)).toBe(2);
  });
});

describe('after sign-in', () => {
  it('returns to the page asked for only when it belongs to the role', () => {
    expect(afterSignIn('client', '/c/garaj')).toBe('/c/garaj');
    expect(afterSignIn('client', '/s/panou')).toBe('/c/cauta');
    expect(afterSignIn('shop', undefined)).toBe('/s/panou');
    expect(afterSignIn('admin', '/admin/moderare')).toBe('/admin/moderare');
    expect(afterSignIn('client', '/cont-nou')).toBe('/c/cauta');
  });
});

describe('legal documents markdown', () => {
  it('reads headings, lists, tables, quotes and inline marks', () => {
    const blocks = parseMarkdown(
      [
        '# Titlu',
        '',
        '**Ultima actualizare:** [ZZ.LL.AAAA]',
        '',
        '## 1. Secțiune',
        '- unu;',
        '  - sub',
        '- doi',
        '',
        '| Scop | Temei |',
        '|---|---|',
        '| Cont | Contract |',
        '',
        '> **Notă:** text',
        '',
        '---',
      ].join('\n'),
    );
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'heading', 'list', 'table', 'quote', 'rule']);
    const list = blocks[3];
    expect(list?.type === 'list' && list.items.length).toBe(2);
    expect(list?.type === 'list' && list.items[0]!.children.length).toBe(1);
  });

  it('links only to web and mail addresses', () => {
    expect(parseInline('[anpc.ro](https://anpc.ro)')).toEqual([
      { type: 'link', href: 'https://anpc.ro', children: [{ type: 'text', text: 'anpc.ro' }] },
    ]);
    expect(parseInline('[x](javascript:alert(1))')).not.toContainEqual(expect.objectContaining({ type: 'link' }));
  });
});
