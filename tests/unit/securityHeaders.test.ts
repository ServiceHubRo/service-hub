import { describe, expect, it } from 'vitest';
import {
  contentSecurityPolicy,
  headersFile,
  inlineScripts,
  originOf,
  parseHeadersFile,
  securityHeaders,
} from '../../src/lib/securityHeaders';

const base = { supabaseUrl: 'https://abcdefgh.supabase.co', scriptHashes: ['sha256-abc='] };
const directive = (csp: string, name: string) => csp.split('; ').find((d) => d.startsWith(`${name} `)) ?? '';

describe('security headers', () => {
  it('allows only this build’s Supabase project, Sentry and the map tiles', () => {
    const csp = contentSecurityPolicy({ ...base, sentryDsn: 'https://key@o1.ingest.de.sentry.io/42' });
    expect(directive(csp, 'connect-src')).toBe(
      "connect-src 'self' https://abcdefgh.supabase.co wss://abcdefgh.supabase.co https://o1.ingest.de.sentry.io",
    );
    expect(directive(csp, 'img-src')).toBe("img-src 'self' data: blob: https://abcdefgh.supabase.co https://tile.openstreetmap.org");
    expect(directive(csp, 'script-src')).toBe("script-src 'self' 'sha256-abc='");
    expect(directive(csp, 'frame-src')).toBe("frame-src 'none'");
    expect(directive(csp, 'frame-ancestors')).toBe("frame-ancestors 'none'");
    expect(directive(csp, 'object-src')).toBe("object-src 'none'");
    expect(csp).not.toContain('unsafe-eval');
  });

  it('adds Cloudflare Turnstile only when CAPTCHA is on, and the map provider from its address', () => {
    const csp = contentSecurityPolicy({
      ...base,
      turnstile: true,
      mapTileUrl: 'https://api.maptiler.com/maps/streets-v2-dark/{z}/{x}/{y}.png?key=abc',
    });
    expect(directive(csp, 'script-src')).toContain('https://challenges.cloudflare.com');
    expect(directive(csp, 'frame-src')).toBe('frame-src https://challenges.cloudflare.com');
    expect(directive(csp, 'img-src')).toContain('https://api.maptiler.com');
    expect(directive(csp, 'img-src')).not.toContain('openstreetmap');
    expect(directive(contentSecurityPolicy({ ...base, mapTileUrl: 'https://{s}.tiles.example.com/{z}/{x}/{y}.png' }), 'img-src')).toContain(
      'https://*.tiles.example.com',
    );
  });

  it('leaves out what is not set or not an address', () => {
    const csp = contentSecurityPolicy({ scriptHashes: [], supabaseUrl: '', sentryDsn: 'nonsense' });
    expect(directive(csp, 'connect-src')).toBe("connect-src 'self'");
    expect(originOf('javascript:alert(1)')).toBeNull();
    expect(originOf('http://127.0.0.1:54321')).toBe('http://127.0.0.1:54321');
  });

  it('writes and reads back the Netlify file', () => {
    const headers = securityHeaders(base);
    expect(headers.map(([n]) => n)).toEqual([
      'Content-Security-Policy',
      'Strict-Transport-Security',
      'X-Frame-Options',
      'X-Content-Type-Options',
      'Referrer-Policy',
      'Permissions-Policy',
      'Cross-Origin-Opener-Policy',
    ]);
    const file = headersFile(headers);
    expect(file.startsWith('/*\n  Content-Security-Policy: ')).toBe(true);
    expect(parseHeadersFile(file)).toEqual(headers);
  });

  it('finds the inline scripts of a page, not the ones loaded from a file', () => {
    const html = '<script>one()</script><script type="module" src="/a.js"></script><script>\n two()\n</script>';
    expect(inlineScripts(html)).toEqual(['one()', '\n two()\n']);
  });
});

describe('new passwords', () => {
  it('need 8 characters with letters and digits, like Supabase Auth (LANSARE 4.6c)', async () => {
    const { passwordProblem } = await import('../../src/lib/password');
    expect(passwordProblem('Ab1')).toBe('short');
    expect(passwordProblem('parolalunga')).toBe('letters_digits');
    expect(passwordProblem('12345678')).toBe('letters_digits');
    expect(passwordProblem('ăîșțâ12345')).toBe('letters_digits');
    expect(passwordProblem('parolalunga1')).toBeNull();
    expect(passwordProblem('Parola-Noua-2026')).toBeNull();
  });
});
