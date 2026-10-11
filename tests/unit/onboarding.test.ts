import { describe, expect, it } from 'vitest';
import { onboardingSteps, type OnboardingInput } from '../../src/lib/onboarding';

const base: OnboardingInput = { role: 'client', location: 'prompt', push: 'prompt', locationPutOff: false, pushPutOff: false };

describe('first start of the app', () => {
  it('a client is asked for the location, then for notifications', () => {
    expect(onboardingSteps(base)).toEqual(['location', 'push']);
  });

  it('a shop is asked only for notifications; the admin for nothing', () => {
    expect(onboardingSteps({ ...base, role: 'shop', location: 'unknown' })).toEqual(['push']);
    expect(onboardingSteps({ ...base, role: 'admin' })).toEqual([]);
  });

  it('waits while a permission is still being read', () => {
    expect(onboardingSteps({ ...base, push: 'unknown' })).toBeNull();
    expect(onboardingSteps({ ...base, location: 'unknown' })).toBeNull();
  });

  it('skips what was already answered or put off', () => {
    expect(onboardingSteps({ ...base, location: 'granted' })).toEqual(['push']);
    expect(onboardingSteps({ ...base, push: 'denied' })).toEqual(['location']);
    expect(onboardingSteps({ ...base, push: 'on' })).toEqual(['location']);
    expect(onboardingSteps({ ...base, push: 'off' })).toEqual(['location', 'push']); // allowed, never turned on
    expect(onboardingSteps({ ...base, locationPutOff: true, pushPutOff: true })).toEqual([]);
    expect(onboardingSteps({ ...base, push: 'unsupported', location: 'unsupported' })).toEqual([]);
  });
});
