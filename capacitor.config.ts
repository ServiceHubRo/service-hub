import type { CapacitorConfig } from '@capacitor/cli';

// The phone apps (T20): the same web app (the Vite build in dist/), wrapped by Capacitor. The
// Android project lives in android/; `npm run android:sync` copies a fresh build into it.
const config: CapacitorConfig = {
  appId: 'ro.servicehub.app',
  appName: 'Service-Hub',
  webDir: 'dist',
  // The app's own address inside the phone is https://localhost (a secure origin, like the site).
  android: {
    backgroundColor: '#14161A',
  },
  plugins: {
    SystemBars: {
      // The bars are handled by MainActivity.java: Capacitor's handling left Android's three
      // buttons over the tab bar on some phones. Light icons and buttons on the dark bars.
      insetsHandling: 'disable',
      style: 'DARK',
    },
    SplashScreen: {
      // Hidden by the app once its first screen is drawn (src/app/NativeBridge.tsx), and in any case
      // after 2.5 s: on a second start the app can be ready before the launch screen is even shown,
      // and a launch screen waiting for the app would then stay forever (seen on testers' phones).
      launchAutoHide: true,
      launchShowDuration: 2500,
      launchFadeOutDuration: 200,
      backgroundColor: '#14161A',
      showSpinner: false,
    },
  },
};

export default config;
