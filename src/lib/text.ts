/** Lower-case without diacritics: `Frâne` → `frane`, `Șasiu` → `sasiu`. */
export function fold(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * The words of a search, folded. A word's last vowel is optional so singular and plural both
 * match ("frane" finds "Plăcuțe de frână", "anvelopa" finds "Anvelope"), like search_shops.
 */
export function searchWords(query: string): string[] {
  return fold(query)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 ? w.replace(/[aeiouy]$/, '') : w));
}

/** Whether every word of the search appears in at least one of the texts. */
export function matchesWords(words: string[], ...texts: string[]): boolean {
  const haystack = texts.map(fold).join(' ');
  return words.every((w) => haystack.includes(w));
}
