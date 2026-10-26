import { beforeEach, describe, expect, it } from 'vitest';
import { isAwaitingSignUp } from '../../src/data/auth';
import { forgetGoogleSignUp, recallGoogleSignUp, rememberGoogleSignUp } from '../../src/screens/auth/googleSignUp';

// T48: who waits for "Finalizează contul", and what Cont nou hands over to it.

describe('isAwaitingSignUp', () => {
  it('is true only for a sign-in through another provider', () => {
    expect(isAwaitingSignUp({ app_metadata: { provider: 'google' } })).toBe(true);
    expect(isAwaitingSignUp({ app_metadata: { provider: 'email' } })).toBe(false);
    expect(isAwaitingSignUp({ app_metadata: {} })).toBe(false);
    expect(isAwaitingSignUp({})).toBe(false);
  });
});

describe('the choice made on Cont nou', () => {
  beforeEach(() => sessionStorage.clear());

  it('comes back after Google, then is forgotten', () => {
    rememberGoogleSignUp({ role: 'shop', referral: 'S-00042' });
    expect(recallGoogleSignUp()).toEqual({ role: 'shop', referral: 'S-00042' });
    forgetGoogleSignUp();
    expect(recallGoogleSignUp()).toEqual({ role: undefined, referral: undefined });
  });

  it('ignores anything that is not a role or a code', () => {
    sessionStorage.setItem('sh_google_signup', JSON.stringify({ role: 'admin', referral: 42 }));
    expect(recallGoogleSignUp()).toEqual({ role: undefined, referral: undefined });
    sessionStorage.setItem('sh_google_signup', 'not json');
    expect(recallGoogleSignUp()).toEqual({});
  });
});
