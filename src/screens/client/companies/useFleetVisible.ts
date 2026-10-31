import { useEffect, useState } from 'react';
import { fetchMyFleetAccess } from '../../../data/fleet';

/**
 * Whether the companies part of Cont is shown (T63b/T63c): when the database says this account may
 * use fleets (`my_fleet_access()`: `platform_settings.fleet_enabled` on, or the account is a fleet
 * test account). Until the fleet launch the switch stays off on the real project, so there only the
 * test accounts Eduard marks see it. The database refuses everything else, whatever the browser shows.
 */
export function useFleetVisible(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let alive = true;
    fetchMyFleetAccess().then(
      (enabled) => {
        if (alive) setOn(enabled);
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, []);
  return on;
}
