/** Netlify build context (see vite.config.ts). */
export const APP_CONTEXT: string = __APP_CONTEXT__;

/** Deploy previews, branch deploys and local dev. Test-only helpers are shown only here. */
export const IS_TEST_BUILD = APP_CONTEXT !== 'production';

/**
 * The `?rol=client|service|admin` switch. On in every build, the published site included, so the
 * interfaces can be tried on a phone before real accounts exist. T04 removes it with accounts.
 */
export const ROLE_SWITCH_ENABLED = true;
