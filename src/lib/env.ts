/** Netlify build context (see vite.config.ts). */
export const APP_CONTEXT: string = __APP_CONTEXT__;

/** Deploy previews, branch deploys and local dev. Test-only helpers are shown only here. */
export const IS_TEST_BUILD = APP_CONTEXT !== 'production';

/** The commit this build was made from (Netlify COMMIT_REF), empty for local builds. Sent with error reports. */
export const APP_RELEASE: string = __APP_RELEASE__;
