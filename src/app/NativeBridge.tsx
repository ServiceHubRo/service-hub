import { App as CapApp } from '@capacitor/app';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { setAuthLinkError, supabase } from '../data/supabase';
import { IS_NATIVE, parseAppLink } from '../lib/native';

/**
 * What only the phone app needs (T20), nothing on the web: the dark status bar, the launch screen
 * hidden once the app is drawn, Android's Back button walking back through the screens (and
 * leaving the app from the first one), and the links from emails opening the right screen
 * signed in (ro.servicehub.app://app/…#access_token=…).
 */
export function NativeBridge() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!IS_NATIVE) return;
    void StatusBar.setStyle({ style: Style.Dark }).catch(() => undefined);
    void StatusBar.setBackgroundColor({ color: '#14161A' }).catch(() => undefined);
    void SplashScreen.hide().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!IS_NATIVE) return;

    async function openLink(url: string) {
      const link = parseAppLink(url);
      if (!link) return;
      const error = link.params.get('error_code') ?? link.params.get('error');
      const access = link.params.get('access_token');
      const refresh = link.params.get('refresh_token');
      if (error) setAuthLinkError(error);
      else if (access && refresh && supabase) {
        const { error: sessionError } = await supabase.auth.setSession({ access_token: access, refresh_token: refresh });
        if (sessionError) setAuthLinkError('otp_expired');
      }
      navigate(link.path, { replace: true });
    }

    const opened = CapApp.addListener('appUrlOpen', ({ url }) => void openLink(url));
    // The app was started by the link itself.
    void CapApp.getLaunchUrl()
      .then((launch) => {
        if (launch?.url) void openLink(launch.url);
      })
      .catch(() => undefined);
    const back = CapApp.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack) window.history.back();
      else void CapApp.exitApp();
    });
    return () => {
      void opened.then((h) => h.remove());
      void back.then((h) => h.remove());
    };
  }, [navigate]);

  return null;
}
