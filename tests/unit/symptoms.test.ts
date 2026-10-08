import { describe, expect, it } from 'vitest';
import { composeUnsureNote, parseSymptoms, toggleSymptom, unsureDescribed } from '../../src/lib/symptoms';

describe('constatare tehnică', () => {
  it('reads the ticks from the address: known ones, once, in order', () => {
    expect(parseSymptoms('leak,noise,nope,leak')).toEqual(['noise', 'leak']);
    expect(parseSymptoms(null)).toEqual([]);
  });

  it('ticks and unticks, keeping the order of the list', () => {
    expect(toggleSymptom(['leak'], 'noise')).toEqual(['noise', 'leak']);
    expect(toggleSymptom(['noise', 'leak'], 'noise')).toEqual(['leak']);
  });

  it('asks for a tick or a few words', () => {
    expect(unsureDescribed([], '')).toBe(false);
    expect(unsureDescribed([], ' ok ')).toBe(false);
    expect(unsureDescribed([], 'scârțâie')).toBe(true);
    expect(unsureDescribed(['noise'], '')).toBe(true);
  });

  it('puts the ticks first, then the words, within the limit', () => {
    expect(composeUnsureNote('Simptome semnalate: zgomote neobișnuite.', ' la frânare ', 1000)).toBe(
      'Simptome semnalate: zgomote neobișnuite.\nla frânare',
    );
    expect(composeUnsureNote(null, 'la frânare', 1000)).toBe('la frânare');
    expect(composeUnsureNote('abc', 'defgh', 6)).toBe('abc\nde');
  });
});
