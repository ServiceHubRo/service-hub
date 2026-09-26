import { describe, expect, it } from 'vitest';
import { PUBLIC_PAGES, robotsTxt, sitemapXml } from '../../src/lib/seoFiles';

describe('robots.txt and sitemap.xml (T19c)', () => {
  it('a preview or local build keeps every search engine away', () => {
    expect(robotsTxt(false, 'https://deploy-preview-40--service-hubapp.netlify.app')).toBe('User-agent: *\nDisallow: /\n');
  });

  it('the published site is open, except the screens behind an account, and names its sitemap', () => {
    const txt = robotsTxt(true, 'https://service-hub.ro');
    expect(txt).toContain('User-agent: *\nAllow: /\n');
    for (const p of ['/c/', '/s/', '/admin/', '/invitatie/', '/parola-noua']) expect(txt).toContain(`Disallow: ${p}\n`);
    expect(txt).not.toMatch(/^Disallow: \/$/m);
    expect(txt.trim().endsWith('Sitemap: https://service-hub.ro/sitemap.xml')).toBe(true);
  });

  it('the sitemap lists the public pages with absolute addresses', () => {
    const xml = sitemapXml('https://service-hub.ro');
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual(PUBLIC_PAGES.map((p) => `https://service-hub.ro${p}`));
    expect(locs).toContain('https://service-hub.ro/legal/termeni');
  });
});
