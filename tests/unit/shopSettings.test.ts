import { describe, expect, it } from 'vitest';
import { fold, matchesWords, searchWords } from '../../src/lib/text';
import { normalizeUrl } from '../../src/lib/url';
import { newInviteToken } from '../../src/data/shop';

describe('catalog search (no diacritics, singular/plural)', () => {
  it('folds diacritics and case', () => {
    expect(fold('Frâne ȘI Țevi')).toBe('frane si tevi');
    expect(fold('Plăcuțe de frână')).toBe('placute de frana');
  });

  it('"frane" finds "Frâne" and "Plăcuțe de frână"', () => {
    const words = searchWords('frane');
    expect(matchesWords(words, 'Frâne')).toBe(true);
    expect(matchesWords(words, 'Plăcuțe de frână')).toBe(true);
    expect(matchesWords(words, 'Schimb ulei')).toBe(false);
  });

  it('every word must match, in either language', () => {
    expect(matchesWords(searchWords('schimb ulei'), 'Schimb ulei și filtre', 'Oil and filter change')).toBe(true);
    expect(matchesWords(searchWords('oil change'), 'Schimb ulei și filtre', 'Oil and filter change')).toBe(true);
    expect(matchesWords(searchWords('ulei frane'), 'Schimb ulei')).toBe(false);
  });

  it('an empty search has no words', () => {
    expect(searchWords('  ')).toEqual([]);
  });
});

describe('website addresses', () => {
  it('adds https:// when missing', () => {
    expect(normalizeUrl('www.atelier.ro')).toBe('https://www.atelier.ro');
    expect(normalizeUrl('facebook.com/atelier.demo')).toBe('https://facebook.com/atelier.demo');
    expect(normalizeUrl('http://atelier.ro')).toBe('http://atelier.ro');
  });

  it('refuses what is not a web address', () => {
    expect(normalizeUrl('atelier')).toBeNull();
    expect(normalizeUrl('www.atelier .ro')).toBeNull();
    expect(normalizeUrl('')).toBeNull();
  });
});

describe('invitation tokens', () => {
  it('are 64 hex characters, different every time', () => {
    const a = newInviteToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(newInviteToken()).not.toBe(a);
  });
});
