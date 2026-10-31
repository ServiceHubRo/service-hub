import { useEffect, useState } from 'react';
import { fetchFleetEnabled } from '../../../data/companies';
import { IS_TEST_BUILD } from '../../../lib/env';

/**
 * Whether the companies part of Cont is shown (T63b). Only in test builds until the fleet launch
 * (T63h), and only while `platform_settings.fleet_enabled` is on: the published site shows nothing
 * even if a test and the real site share a database. The database refuses everything when the
 * switch is off, whatever the browser shows.
 */
export function useFleetVisible(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!IS_TEST_BUILD) return;
    let alive = true;
    fetchFleetEnabled().then(
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
