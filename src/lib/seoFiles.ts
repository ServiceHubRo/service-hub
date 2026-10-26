// robots.txt and sitemap.xml, written next to the app at build time (vite.config.ts, T19c).
// Only the published site may be indexed: deploy previews and local builds tell every search
// engine to stay away, so a test link never shows up in Google next to service-hub.ro.
import { CONTACT } from './contact.ts';

/** The public pages worth finding in a search engine (no account needed to open them). */
export const PUBLIC_PAGES = ['/', '/legal/termeni', '/legal/confidentialitate', '/legal/cookies', '/verifica'] as const;

/** Screens behind an account or a one-time link: nothing there for a search engine. */
const PRIVATE_PREFIXES = ['/c/', '/s/', '/admin/', '/p/', '/invitatie/', '/parola-noua', '/confirma-email', '/dev/'];

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

/**
 * The <head> additions of the page `/` drawn at build time (T46): its official address and what
 * Service-Hub is, as structured data for search engines (schema.org Organization and WebSite).
 * Only the company's own public contact, the one in the page's footer.
 */
export function homeHeadTags(siteUrl: string): string {
  const home = `${siteUrl}/`;
  const organization = `${home}#organization`;
  const data = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': organization,
        name: 'Service-Hub',
        url: home,
        logo: `${siteUrl}/icons/icon-512.png`,
        email: CONTACT.email,
        telephone: CONTACT.phone,
        areaServed: { '@type': 'Country', name: 'România' },
        contactPoint: {
          '@type': 'ContactPoint',
          contactType: 'customer support',
          email: CONTACT.email,
          telephone: CONTACT.phone,
          availableLanguage: ['ro', 'en'],
        },
      },
      { '@type': 'WebSite', '@id': `${home}#website`, name: 'Service-Hub', url: home, inLanguage: 'ro-RO', publisher: { '@id': organization } },
    ],
  };
  // `<` escaped: nothing in the data can close the script element.
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return [`<link rel="canonical" href="${home}" />`, `<script type="application/ld+json">${json}</script>`].join('\n    ');
}
