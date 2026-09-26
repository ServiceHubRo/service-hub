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
    SplashScreen: {
      // Hidden by the app once its first screen is drawn (src/app/NativeBridge.tsx).
      launchAutoHide: false,
      backgroundColor: '#14161A',
      showSpinner: false,
    },
  },
};

export default config;
