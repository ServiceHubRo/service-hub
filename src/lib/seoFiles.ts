// robots.txt and sitemap.xml, written next to the app at build time (vite.config.ts, T19c).
// Only the published site may be indexed: deploy previews and local builds tell every search
// engine to stay away, so a test link never shows up in Google next to service-hub.ro.

/** The public pages worth finding in a search engine (no account needed to open them). */
export const PUBLIC_PAGES = ['/', '/legal/termeni', '/legal/confidentialitate', '/legal/cookies', '/verifica'] as const;

/** Screens behind an account or a one-time link: nothing there for a search engine. */
const PRIVATE_PREFIXES = ['/c/', '/s/', '/admin/', '/invitatie/', '/parola-noua', '/confirma-email', '/dev/'];

export function robotsTxt(published: boolean, siteUrl: string): string {
  if (!published) return 'User-agent: *\nDisallow: /\n';
  return [
    'User-agent: *',
    'Allow: /',
    ...PRIVATE_PREFIXES.map((p) => `Disallow: ${p}`),
    '',
    `Sitemap: ${siteUrl}/sitemap.xml`,
    '',
  ].join('\n');
}

export function sitemapXml(siteUrl: string): string {
  const urls = PUBLIC_PAGES.map((p) => `  <url><loc>${siteUrl}${p}</loc></url>`);
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ...urls, '</urlset>', ''].join('\n');
}
