import { describe, expect, it } from 'vitest';
import { slideFor } from '../../src/lib/screenSlide';

describe('slideFor', () => {
  it('fades between bottom-bar items', () => {
    expect(slideFor('/c/cauta', '/c/garaj', false)).toBe('fade');
    expect(slideFor('/s/programari/123', '/s/panou', true)).toBe('fade');
  });

  it('slides forward deeper into the same item and back when returning', () => {
    expect(slideFor('/c/mesaje', '/c/mesaje/abc', false)).toBe('forward');
    expect(slideFor('/c/mesaje/abc', '/c/mesaje', false)).toBe('back');
    expect(slideFor('/c/cont/date', '/c/cont/legal', true)).toBe('back');
  });

  it('moves nothing when only the query changed', () => {
    expect(slideFor('/c/programari', '/c/programari', false)).toBe('none');
  });
});
