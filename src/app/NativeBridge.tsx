import { App as CapApp } from '@capacitor/app';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { setAuthLinkError, supabase } from '../data/supabase';
import { IS_NATIVE, hasNavButtons, parseAppLink } from '../lib/native';

/**
 * What only the phone app needs (T20), nothing on the web: the dark status bar, the launch screen
 * hidden once the app is drawn, Android's Back button walking back through the screens (and
 * leaving the app from the first one), and the links from emails opening the right screen
 * signed in (ro.servicehub.app://app/…#access_token=…). It also marks `<html data-nav-buttons>`
 * when Android shows its three navigation buttons, so the public pages put a strip behind them.
 */
export function NativeBridge() {
  const navigate = useNavigate();

  useEffect(() => {
    // The app has drawn: the start-up guard in index.html stays quiet.
    (window as Window & { __shStarted?: boolean }).__shStarted = true;
    if (!IS_NATIVE) return;
    void StatusBar.setStyle({ style: Style.Dark }).catch(() => undefined);
    void StatusBar.setBackgroundColor({ color: '#14161A' }).catch(() => undefined);
    // Once now and twice more: a hide that arrives before the launch screen is up does nothing.
    const hide = () => void SplashScreen.hide().catch(() => undefined);
    hide();
    const timers = [400, 1200].map((ms) => window.setTimeout(hide, ms));
    const resumed = CapApp.addListener('resume', hide);
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      void resumed.then((h) => h.remove());
    };
  }, []);

  useEffect(() => {
    if (!IS_NATIVE) return;
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;left:0;bottom:0;width:0;height:env(safe-area-inset-bottom);visibility:hidden;pointer-events:none';
    document.body.appendChild(probe);
    // Measured again when the phone turns or the navigation mode changes in the settings.
    const measure = () => {
      document.documentElement.toggleAttribute('data-nav-buttons', hasNavButtons(probe.getBoundingClientRect().height));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
      probe.remove();
    };
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
