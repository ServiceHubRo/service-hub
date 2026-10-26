import { beforeEach, describe, expect, it } from 'vitest';
import { isAwaitingSignUp, socialProviderOf } from '../../src/data/auth';
import { forgetSocialSignUp, recallSocialSignUp, rememberSocialSignUp } from '../../src/screens/auth/socialSignUp';

// T48, T49: who waits for "Finalizează contul", through which provider, and what Cont nou hands over to it.

describe('isAwaitingSignUp', () => {
  it('is true only for a sign-in through another provider', () => {
    expect(isAwaitingSignUp({ app_metadata: { provider: 'google' } })).toBe(true);
    expect(isAwaitingSignUp({ app_metadata: { provider: 'email' } })).toBe(false);
    expect(isAwaitingSignUp({ app_metadata: {} })).toBe(false);
    expect(isAwaitingSignUp({})).toBe(false);
  });

  it('names Google or Apple, nothing else', () => {
    expect(socialProviderOf({ app_metadata: { provider: 'google' } })).toBe('google');
    expect(socialProviderOf({ app_metadata: { provider: 'apple' } })).toBe('apple');
    expect(socialProviderOf({ app_metadata: { provider: 'email' } })).toBeNull();
    expect(socialProviderOf({})).toBeNull();
  });
});

describe('the choice made on Cont nou', () => {
  beforeEach(() => sessionStorage.clear());

  it('comes back after Google, then is forgotten', () => {
    rememberSocialSignUp({ role: 'shop', referral: 'S-00042' });
    expect(recallSocialSignUp()).toEqual({ role: 'shop', referral: 'S-00042' });
    forgetSocialSignUp();
    expect(recallSocialSignUp()).toEqual({ role: undefined, referral: undefined });
  });

  it('ignores anything that is not a role or a code', () => {
    sessionStorage.setItem('sh_social_signup', JSON.stringify({ role: 'admin', referral: 42 }));
    expect(recallSocialSignUp()).toEqual({ role: undefined, referral: undefined });
    sessionStorage.setItem('sh_social_signup', 'not json');
    expect(recallSocialSignUp()).toEqual({});
  });
});
