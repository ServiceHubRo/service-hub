import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { checkSupabaseConfig, describeConfigProblem } from './src/lib/supabaseConfig.ts';

// Netlify sets CONTEXT to "production", "deploy-preview", "branch-deploy" or "dev".
// Anything that is not the production site counts as a test build.
const context = process.env.CONTEXT ?? (process.env.NODE_ENV === 'production' ? 'local-build' : 'dev');

// The address link previews point to (og:url, og:image must be absolute). Netlify sets URL to the
// site's main address (service-hub.ro once the domain is moved, T19) and DEPLOY_PRIME_URL to a
// preview's own address.
const siteUrl = (
  (context === 'production' ? process.env.URL : process.env.DEPLOY_PRIME_URL ?? process.env.URL) ?? 'https://service-hub.ro'
).replace(/\/+$/, '');

export default defineConfig(({ command, mode }) => {
  // On Netlify a build without a usable Supabase address would publish a site that cannot reach
  // the database; stop it here with the reason instead (the variables are read at build time).
  if (command === 'build' && process.env.NETLIFY === 'true') {
    const env = loadEnv(mode, process.cwd(), 'VITE_');
    const config = checkSupabaseConfig(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
    if (!config.ok) {
      throw new Error(
        `${describeConfigProblem(config.problem)} (Netlify context "${context}"). ` +
          'Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Netlify → Site configuration → ' +
          'Environment variables, scope "Builds", for all deploy contexts, then retry the deploy.',
      );
    }
  }

  return {
    plugins: [
      react(),
      {
        name: 'site-url',
        transformIndexHtml: (html: string) => html.replaceAll('%SITE_URL%', siteUrl),
      },
    ],
    build: {
      // The start file holds React, the router, the Supabase client and both dictionaries (RO + EN);
      // each role's screens are loaded on their own after sign-in (src/app/App.tsx).
      chunkSizeWarningLimit: 800,
    },
    define: {
      __APP_CONTEXT__: JSON.stringify(context),
    },
    test: {
      environment: 'jsdom',
      include: ['tests/unit/**/*.test.{ts,tsx}'],
    },
  };
});
