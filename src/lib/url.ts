/**
 * A website or Facebook address as typed (`www.atelier.ro`, `facebook.com/atelier`) → a full
 * `https://` link, or null when it is not a web address.
 */
export function normalizeUrl(value: string): string | null {
  const v = value.trim();
  if (v === '' || /\s/.test(v)) return null;
  const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(url.hostname)) return null;
  return url.href.length > 300 ? null : withScheme;
}
