import { describe, expect, it } from 'vitest';
import { placeCard, spotBox, TOUR_STEPS } from '../../src/app/tour/tourSteps';
import { en } from '../../src/i18n/en';
import { ro } from '../../src/i18n/ro';

const card = { width: 340, height: 200 };
const phone = { width: 390, height: 844 };
const laptop = { width: 1440, height: 900 };

describe('the tour card', () => {
  it('sits under a spot near the top, inside the screen', () => {
    const pos = placeCard({ top: 120, left: 16, width: 358, height: 48 }, card, phone);
    expect(pos.top).toBe(120 + 48 + 14);
    expect(pos.left).toBeGreaterThanOrEqual(16);
    expect(pos.left + card.width).toBeLessThanOrEqual(phone.width - 16);
  });

  it('sits above a bottom-bar tab', () => {
    const tab = { top: 790, left: 78, width: 78, height: 54 };
    const pos = placeCard(tab, card, phone);
    expect(pos.top + card.height).toBeLessThanOrEqual(tab.top);
  });

  it('sits beside a sidebar item on a wide screen', () => {
    const item = { top: 124, left: 4, width: 232, height: 44 };
    const pos = placeCard(item, card, laptop);
    expect(pos.left).toBe(4 + 232 + 14);
  });

  it('is centered without a spot (the welcome)', () => {
    const pos = placeCard(null, card, phone);
    expect(pos.left).toBe((phone.width - card.width) / 2);
  });

  it('keeps the light inside the screen', () => {
    expect(spotBox({ top: 0, left: 0, width: 240, height: 44 }, laptop)).toEqual({ top: 4, left: 4, width: 242, height: 46 });
  });
});

describe('the tour steps', () => {
  it('have a title and a line in Romanian and English', () => {
    for (const steps of Object.values(TOUR_STEPS)) {
      for (const s of steps) {
        expect(ro[s.titleKey]).toBeTruthy();
        expect(ro[s.bodyKey]).toBeTruthy();
        expect(en[s.titleKey]).toBeTruthy();
        expect(en[s.bodyKey]).toBeTruthy();
      }
    }
  });
});
