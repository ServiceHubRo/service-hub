import { describe, expect, it } from 'vitest';
import { APP_LINK_ORIGIN, IS_NATIVE, emailLinkOrigin, hasNavButtons, parseAppLink, webOrigin } from '../../src/lib/native';

describe('the phone app (T20)', () => {
  it('on the web, links keep pointing at the page’s own address', () => {
    expect(IS_NATIVE).toBe(false);
    expect(emailLinkOrigin()).toBe(window.location.origin);
    expect(webOrigin()).toBe(window.location.origin);
  });

  it('reads an email link that opened the app: the screen and Supabase’s answer', () => {
    const ok = parseAppLink(`${APP_LINK_ORIGIN}/parola-noua#access_token=a.b.c&refresh_token=r1&type=recovery`)!;
    expect(ok.path).toBe('/parola-noua');
    expect(ok.params.get('access_token')).toBe('a.b.c');
    expect(ok.params.get('refresh_token')).toBe('r1');

    const failed = parseAppLink(`${APP_LINK_ORIGIN}/#error=access_denied&error_code=otp_expired`)!;
    expect(failed.path).toBe('/');
    expect(failed.params.get('error_code')).toBe('otp_expired');

    expect(parseAppLink(APP_LINK_ORIGIN)!.path).toBe('/');
    expect(parseAppLink(`${APP_LINK_ORIGIN}/invitatie/abc?x=1`)!.path).toBe('/invitatie/abc');
  });

  it('ignores links that are not the app’s own', () => {
    expect(parseAppLink('https://service-hub.ro/parola-noua#access_token=x')).toBeNull();
    expect(parseAppLink('ro.servicehub.app://other/parola-noua')).toBeNull();
  });

  it('puts a strip only behind Android’s three buttons, not behind a gesture bar or the iPhone’s', () => {
    expect(hasNavButtons(48)).toBe(true);
    expect(hasNavButtons(0)).toBe(false);
    expect(hasNavButtons(16)).toBe(false);
    expect(hasNavButtons(24)).toBe(false);
    expect(hasNavButtons(34)).toBe(false);
  });
});
