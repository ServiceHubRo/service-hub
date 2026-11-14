import { describe, expect, it } from 'vitest';

// FUN-01 (audit 13 Nov 2026): forms submit with Enter, so a <button> without a type inside one would
// submit it by accident (an HTML button defaults to type="submit"). Every <button> in the app names
// its type; `Button` and `ActionButton` already do.
const SOURCES = import.meta.glob<string>('../../src/**/*.tsx', { query: '?raw', import: 'default', eager: true });

/** The text of the opening tag that starts at `start` (braces counted, so `=>` inside one is skipped). */
function openingTag(src: string, start: number): string {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return src.slice(start, i + 1);
  }
  return src.slice(start);
}

describe('buttons', () => {
  it('every <button> says its type', () => {
    const missing: string[] = [];
    for (const [path, src] of Object.entries(SOURCES)) {
      for (const m of src.matchAll(/<button\b/g)) {
        if (!/\btype=/.test(openingTag(src, m.index))) missing.push(`${path}:${src.slice(0, m.index).split('\n').length}`);
      }
    }
    expect(Object.keys(SOURCES).length).toBeGreaterThan(100);
    expect(missing).toEqual([]);
  });
});
