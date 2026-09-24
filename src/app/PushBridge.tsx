import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { syncPushDevice } from '../data/push';
import { appPath } from '../lib/push';
import { useSession } from './sessionContext';

/**
 * The signed-in app's side of push notifications (T12): keeps this device linked to whoever is
 * signed in, and opens the screen of a tapped notification inside the already open app (the
 * service worker posts the path; routing keeps whatever was typed on other screens).
 */
export function PushBridge() {
  const navigate = useNavigate();
  const userId = useSession().profile?.id;

  useEffect(() => {
    if (userId) void syncPushDevice();
  }, [userId]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; url?: unknown } | null;
      const path = data?.type === 'sh:navigate' ? appPath(data.url) : null;
      if (path) navigate(path);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [navigate]);

  return null;
}
