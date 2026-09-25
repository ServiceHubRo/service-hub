import { startProviders } from './providers';

/** With a local backend, the email and SMS stand-ins run for the whole test run. */
export default async function globalSetup() {
  if (process.env.E2E_BACKEND !== '1') return undefined;
  return startProviders();
}
