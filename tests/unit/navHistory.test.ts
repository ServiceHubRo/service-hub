import { beforeEach, describe, expect, it, vi } from 'vitest';
import { goUp, isSamePlace, previousEntry, recordEntry } from '../../src/lib/navHistory';

function at(idx: number, path: string) {
  window.history.replaceState({ idx }, '');
  recordEntry(path);
}

describe('the in-app way back (P1)', () => {
  beforeEach(() => sessionStorage.clear());

  it('same place: the path, and the query when the target names one', () => {
    expect(isSamePlace('/c/cont/firme', '/c/cont/firme')).toBe(true);
    expect(isSamePlace('/c/cont/firme/', '/c/cont/firme')).toBe(true);
    expect(isSamePlace('/c/cont/firme?x=1', '/c/cont/firme')).toBe(true);
    expect(isSamePlace('/c/firme/a?sectiune=panou', '/c/firme/a?sectiune=vehicule')).toBe(false);
    expect(isSamePlace('/c/firme/a?sectiune=vehicule&filtru=x', '/c/firme/a?sectiune=vehicule')).toBe(true);
    expect(isSamePlace('/c/cont', '/c/cont/firme')).toBe(false);
  });

  it('the parent is the entry before: back through the history, nothing added', () => {
    at(3, '/c/cont/firme');
    at(4, '/c/cont/firme/abc');
    expect(previousEntry()).toBe('/c/cont/firme');
    const navigate = vi.fn();
    goUp(navigate, '/c/cont/firme');
    expect(navigate).toHaveBeenCalledWith(-1);
  });

  it('reached another way (a direct link, another page): the parent replaces this entry', () => {
    at(7, '/c/cauta');
    at(8, '/c/cont/firme/abc');
    const navigate = vi.fn();
    goUp(navigate, '/c/cont/firme');
    expect(navigate).toHaveBeenCalledWith('/c/cont/firme', { replace: true });
  });

  it('the first entry of the tab: replaced as well', () => {
    at(0, '/c/cont/firme/abc');
    const navigate = vi.fn();
    goUp(navigate, '/c/cont/firme');
    expect(navigate).toHaveBeenCalledWith('/c/cont/firme', { replace: true });
  });

  it('kept across a refresh (sessionStorage)', () => {
    at(2, '/c/cont');
    at(3, '/c/cont/firme');
    expect(JSON.parse(sessionStorage.getItem('sh_nav_entries')!)).toMatchObject({ '2': '/c/cont', '3': '/c/cont/firme' });
  });
});
