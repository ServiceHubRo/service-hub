import { useEffect, useState } from 'react';
import { useSession } from '../../../app/sessionContext';
import { ONBOARDING_OFF_KEY } from '../../../app/tour/tourStore';
import { fetchCars } from '../../../data/garage';
import { hideClientGuide } from '../../../data/profile';
import { usePushStatus } from '../../../data/push';
import { storage } from '../../../lib/storage';
import { useOptionalClientBookings } from '../bookings/clientBookingsContext';

export type GuideStepKey = 'car' | 'push' | 'booking';

export interface ClientGuideState {
  visible: boolean;
  /** Still finding out whether to show it (the tour waits for it). */
  pending: boolean;
  steps: { key: GuideStepKey; done: boolean }[];
  hide: () => void;
}

/**
 * "Primii pași" on Caută (T39): add the car, turn on notifications (where the browser can), make
 * the first booking. Each ticks itself when done; all done, or hidden with ✕, it is gone for good
 * (stamped on the account). Shown only once everything it needs has loaded, so it never flashes.
 */
export function useClientGuide(): ClientGuideState {
  const session = useSession();
  const profile = session.profile;
  const bookings = useOptionalClientBookings();
  const push = usePushStatus();
  const hidden = Boolean(profile?.guide_hidden_at) || storage.get(ONBOARDING_OFF_KEY) === '1';
  const [cars, setCars] = useState<number | null>(null);

  useEffect(() => {
    if (hidden) return;
    let cancelled = false;
    fetchCars().then(
      (list) => {
        if (!cancelled) setCars(list.length);
      },
      () => undefined, // without the garage the guide simply stays away
    );
    return () => {
      cancelled = true;
    };
  }, [hidden]);

  const booked = bookings?.state.status === 'ready' ? bookings.state.data.bookings.length > 0 : null;
  // Notifications only where this browser can turn them on.
  const withPush = push === 'prompt' || push === 'off' || push === 'working' || push === 'on';
  const loaded = cars !== null && booked !== null && push !== 'unknown';
  const steps: ClientGuideState['steps'] = [
    { key: 'car', done: (cars ?? 0) > 0 },
    ...(withPush ? [{ key: 'push' as const, done: push === 'on' }] : []),
    { key: 'booking', done: booked === true },
  ];
  const allDone = loaded && steps.every((s) => s.done);

  function hide() {
    const now = session.profile;
    if (!now) return;
    session.setProfile({ ...now, guide_hidden_at: new Date().toISOString() });
    // Best effort, like the banners: if saving fails, the guide comes back on the next start.
    hideClientGuide(now.id).catch(() => undefined);
  }

  useEffect(() => {
    if (allDone && !hidden) hide();
    // hide() reads the session as it is when called.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDone, hidden]);

  return { visible: !hidden && loaded && !allDone, pending: !hidden && !loaded, steps, hide };
}

