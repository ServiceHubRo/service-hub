import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { markTourSeen } from '../../data/profile';
import { storage } from '../../lib/storage';
import { homeOf } from '../roles';
import { useSession } from '../sessionContext';
import { Tour } from './Tour';
import { clearTourRequest, ONBOARDING_OFF_KEY, useTourRequested } from './tourStore';
import { TOUR_READY } from './tourSteps';

/**
 * When the tour runs (T39): once per account (any device), on the home screen (Caută, Panou) once it
 * has loaded and, in the phone app, after the permission screens; again whenever "Turul aplicației"
 * asks for it. Finished or skipped, it is stamped on the account.
 */
export function TourHost({ role }: { role: 'client' | 'shop' }) {
  const session = useSession();
  const profile = session.profile;
  const { pathname } = useLocation();
  const requested = useTourRequested();
  const [running, setRunning] = useState(false);
  const first = Boolean(profile && !profile.tour_seen_at && storage.get(ONBOARDING_OFF_KEY) !== '1');
  const wanted = !running && pathname === homeOf(role) && (first || requested);

  useEffect(() => {
    if (!wanted) return;
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      const ready =
        document.querySelector(TOUR_READY[role]) !== null &&
        document.querySelector('[data-permissions-intro]') === null &&
        document.querySelector('[data-guide-pending]') === null &&
        document.querySelector('main [aria-busy="true"]') === null;
      if (ready) setRunning(true);
      if (ready || tries >= 60) window.clearInterval(timer);
    }, 250);
    return () => window.clearInterval(timer);
  }, [wanted, role]);

  if (!running || !profile) return null;

  function done() {
    setRunning(false);
    clearTourRequest();
    const now = session.profile;
    if (!now || now.tour_seen_at) return;
    // Best effort: if saving fails, the tour comes back on the next start.
    markTourSeen(now.id).then(
      (at) => session.setProfile({ ...now, tour_seen_at: at }),
      () => undefined,
    );
  }

  const name = profile.name?.trim().split(/\s+/)[0] ?? null;
  return <Tour role={role} name={name || null} onDone={done} />;
}
