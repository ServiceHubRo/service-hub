// Where the app lives, for links in emails and SMS.
//
// APP_URL (optional Edge Function secret) is the published app; until launch (T19) that is the
// Netlify site, afterwards https://service-hub.ro. A link may also point to the address the
// request came from (a deploy preview), but only when that address is one of ours — an email
// from service-hub.ro must never carry a link somewhere else.

export const DEFAULT_APP_URL = 'https://service-hub-app.netlify.app';

const OWN_ORIGINS = [
  /^https:\/\/(www\.)?service-hub\.ro$/,
  // The Netlify site and its deploy previews (deploy-preview-12--service-hub-app.netlify.app).
  /^https:\/\/([a-z0-9-]+--)?service-hub-app\.netlify\.app$/,
  // Local development and the browser tests.
  /^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}$/,
];

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/** The app's address (the APP_URL secret when it is a web address), without a trailing slash. */
export function appUrl(configured: string | undefined): string {
  const value = configured?.trim();
  return trimSlash(value && /^https?:\/\/[^/\s]+/.test(value) ? value : DEFAULT_APP_URL);
}

/** The origin a request came from when it is one of ours, else the app's address. */
export function linkBase(origin: string | null | undefined, fallback: string): string {
  const o = trimSlash((origin ?? '').trim());
  return OWN_ORIGINS.some((re) => re.test(o)) ? o : fallback;
}
