import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { checkSupabaseConfig, describeConfigProblem } from './src/lib/supabaseConfig.ts';

// Netlify sets CONTEXT to "production", "deploy-preview", "branch-deploy" or "dev".
// Anything that is not the production site counts as a test build.
const context = process.env.CONTEXT ?? (process.env.NODE_ENV === 'production' ? 'local-build' : 'dev');

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
    plugins: [react()],
    define: {
      __APP_CONTEXT__: JSON.stringify(context),
    },
    test: {
      environment: 'jsdom',
      include: ['tests/unit/**/*.test.{ts,tsx}'],
    },
  };
});
