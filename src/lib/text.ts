/** Lower-case without diacritics: `Frâne` → `frane`, `Șasiu` → `sasiu`. */
export function fold(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * The words of a search, folded. An English plural "s" and then a last vowel are optional, so
 * singular and plural both match ("frane" finds "Plăcuțe de frână", "anvelopa" finds "Anvelope",
 * "brakes" finds "Brake pads") — the same rule as search_words() in the database.
 */
export function searchWords(query: string): string[] {
  return fold(query)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((w) => (w.length >= 5 && w.endsWith('s') ? w.slice(0, -1) : w))
    .map((w) => (w.length >= 4 ? w.replace(/[aeiouy]$/, '') : w));
}

/** Whether every word of the search appears in at least one of the texts. */
export function matchesWords(words: string[], ...texts: string[]): boolean {
  const haystack = texts.map(fold).join(' ');
  return words.every((w) => haystack.includes(w));
}

/** The city a typed search names exactly, ignoring case and diacritics ("brasov" → "Brașov"). */
export function cityNamedBy(query: string, cities: { city: string }[]): string | null {
  const q = fold(query.trim());
  if (!q) return null;
  return cities.find((c) => fold(c.city) === q)?.city ?? null;
}
