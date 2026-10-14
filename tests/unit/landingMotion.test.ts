import { afterEach, describe, expect, it, vi } from 'vitest';
import { revealOnScroll } from '../../src/screens/public/landingMotion';

/** A page with one part on screen and one far below it. */
function page(): { root: HTMLElement; near: HTMLElement; far: HTMLElement } {
  const root = document.createElement('div');
  const near = document.createElement('section');
  const far = document.createElement('section');
  near.dataset.reveal = '';
  far.dataset.reveal = '';
  near.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
  far.getBoundingClientRect = () => ({ top: 5000 }) as DOMRect;
  root.append(near, far);
  return { root, near, far };
}

let seen: ((entries: Partial<IntersectionObserverEntry>[]) => void) | null = null;
class FakeObserver {
  observed: Element[] = [];
  constructor(callback: (entries: Partial<IntersectionObserverEntry>[]) => void) {
    seen = callback;
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  unobserve() {}
  disconnect() {}
}

afterEach(() => {
  vi.unstubAllGlobals();
  seen = null;
});

describe('revealOnScroll', () => {
  it('shows what is on screen at once and the rest when it is reached', () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    const { root, near, far } = page();
    const stop = revealOnScroll(root, true);
    expect(root.dataset.motion).toBe('');
    expect(near.dataset.shown).toBe('');
    expect(far.dataset.shown).toBeUndefined();
    seen?.([{ target: far, isIntersecting: true }]);
    expect(far.dataset.shown).toBe('');
    stop();
    expect(root.dataset.motion).toBeUndefined();
  });

  it('hides nothing when turned off, when the phone asks for less motion, or without IntersectionObserver', () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    const off = page();
    revealOnScroll(off.root, false);
    expect(off.root.dataset.motion).toBeUndefined();

    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce') }) as MediaQueryList);
    const reduced = page();
    revealOnScroll(reduced.root, true);
    expect(reduced.root.dataset.motion).toBeUndefined();

    vi.unstubAllGlobals();
    vi.stubGlobal('IntersectionObserver', undefined);
    const old = page();
    revealOnScroll(old.root, true);
    expect(old.root.dataset.motion).toBeUndefined();
  });
});
