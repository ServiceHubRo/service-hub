import type { MessageKey } from '../../i18n/ro';

/**
 * The tour (T39): after a welcome, one lit spot per main feature, with a line about it. A step whose
 * spot is not on screen (a finished "Primii pași") is left out when the tour starts.
 */
export interface TourStep {
  /** CSS selector of the spot; the first one actually on screen is lit (bottom bar or sidebar). */
  target: string;
  titleKey: MessageKey;
  bodyKey: MessageKey;
}

const nav = (path: string) => `[data-tour="${path}"]`;

export const TOUR_STEPS: Record<'client' | 'shop', TourStep[]> = {
  client: [
    { target: '[data-tour="guide"]', titleKey: 'tour.guide.title', bodyKey: 'tour.client.guide.body' },
    { target: '#search-q', titleKey: 'tour.client.search.title', bodyKey: 'tour.client.search.body' },
    { target: nav('/c/garaj'), titleKey: 'nav.client.garage', bodyKey: 'tour.client.garage.body' },
    { target: nav('/c/programari'), titleKey: 'nav.bookings', bodyKey: 'tour.client.bookings.body' },
    { target: nav('/c/mesaje'), titleKey: 'nav.messages', bodyKey: 'tour.client.messages.body' },
    { target: nav('/c/cont'), titleKey: 'nav.account', bodyKey: 'tour.client.account.body' },
  ],
  shop: [
    { target: '[data-tour="guide"]', titleKey: 'tour.guide.title', bodyKey: 'tour.shop.guide.body' },
    { target: '[data-tour="dashboard"]', titleKey: 'tour.shop.dashboard.title', bodyKey: 'tour.shop.dashboard.body' },
    { target: nav('/s/programari'), titleKey: 'nav.bookings', bodyKey: 'tour.shop.bookings.body' },
    { target: nav('/s/istoric'), titleKey: 'nav.shop.history', bodyKey: 'tour.shop.history.body' },
    { target: nav('/s/mesaje'), titleKey: 'nav.messages', bodyKey: 'tour.shop.messages.body' },
    { target: nav('/s/cont'), titleKey: 'nav.account', bodyKey: 'tour.shop.account.body' },
  ],
};

/** The spot that says the home screen is ready for the tour. */
export const TOUR_READY: Record<'client' | 'shop', string> = {
  client: '#search-q',
  shop: '[data-tour="dashboard"]',
};

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** The first element of `selector` that takes up room on screen (the bottom bar or the sidebar copy). */
export function findSpot(selector: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(selector)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden') return el;
  }
  return null;
}

/** The lit spot: the element with some room around it, kept inside the screen. */
export function spotBox(r: Box, view: { width: number; height: number }, pad = 6): Box {
  const top = Math.max(4, r.top - pad);
  const left = Math.max(4, r.left - pad);
  const bottom = Math.min(view.height - 4, r.top + r.height + pad);
  const right = Math.min(view.width - 4, r.left + r.width + pad);
  return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/**
 * Where the card goes: next to a spot on the left (the sidebar on a wide screen), else under it or,
 * when there is no room below (the bottom bar), above it; always inside the screen. No spot: centered.
 */
export function placeCard(
  spot: Box | null,
  card: { width: number; height: number },
  view: { width: number; height: number },
  gap = 14,
  margin = 16,
): { top: number; left: number } {
  const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));
  if (!spot) {
    return { top: clamp((view.height - card.height) / 2, margin, view.height - margin - card.height), left: (view.width - card.width) / 2 };
  }
  const right = spot.left + spot.width + gap;
  if (view.width >= 1024 && spot.width < view.width / 3 && right + card.width <= view.width - margin) {
    return { top: clamp(spot.top + spot.height / 2 - card.height / 2, margin, view.height - margin - card.height), left: right };
  }
  const left = clamp(spot.left + spot.width / 2 - card.width / 2, margin, view.width - margin - card.width);
  const below = spot.top + spot.height + gap;
  if (below + card.height <= view.height - margin) return { top: below, left };
  return { top: clamp(spot.top - gap - card.height, margin, view.height - margin - card.height), left };
}
