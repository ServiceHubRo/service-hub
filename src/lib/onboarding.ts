import type { PushStatus } from '../data/push';
import type { LocationStatus } from './location';

/**
 * The first start of the phone app (Eduard, 11 Oct: like Tinder and other apps): the permissions
 * the app uses are asked one after the other, each on its own screen, before the system's prompt.
 * A step is offered only while its answer is still open on this device and it was not put off.
 */
export type OnboardingStep = 'location' | 'push';

export interface OnboardingInput {
  role: 'client' | 'shop' | 'admin';
  location: LocationStatus;
  push: PushStatus;
  locationPutOff: boolean;
  pushPutOff: boolean;
}

/** The steps to show, or null while a permission is still being read. */
export function onboardingSteps({ role, location, push, locationPutOff, pushPutOff }: OnboardingInput): OnboardingStep[] | null {
  if (role === 'admin') return [];
  if (push === 'unknown' || (role === 'client' && location === 'unknown')) return null;
  const steps: OnboardingStep[] = [];
  if (role === 'client' && location === 'prompt' && !locationPutOff) steps.push('location');
  // 'off': allowed but never turned on here (Android before 13 needs no prompt for notifications).
  if ((push === 'prompt' || push === 'off') && !pushPutOff) steps.push('push');
  return steps;
}

/** Shown once per account on a device. */
export const onboardedKey = (userId: string) => `sh_onboarded:${userId}`;
