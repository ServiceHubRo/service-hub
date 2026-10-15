/**
 * The app's animations (Eduard, 15 Oct), each with its own switch: false turns that one off and
 * leaves the screen as it was. None of them runs when the phone asks for less motion.
 */
export const MOTION = {
  /** A green check that draws itself after a booking, an accepted quote, a sent quote. */
  successCheck: true,
  /** The booking's status line fills up to the new step when the status changes. */
  statusLine: true,
  /** The shop's Panou numbers count up from 0; the Rapoarte charts draw themselves. */
  countUp: true,
  /** The next screen slides in over the one before, as on an iPhone. */
  screenSlide: true,
  /** The Garage's ITP / RCA / rovinietă rings fill to the days left. */
  expiryRings: true,
  /** A tapped bottom-bar icon gives a small bounce. */
  tabBounce: true,
  /** The review stars light up one after another; the tapped one pops. */
  starPop: true,
  /** The empty screens' line drawings draw themselves. */
  emptyDrawings: true,
  /** The car's history: the timeline grows down and its points appear in turn. */
  historyTimeline: true,
  /** A shop saved to favorites: the heart pops and a ring spreads from it. */
  favoritePop: true,
  /** A count on the tab bar (messages, requests, quotes) gives a small jump when it grows. */
  badgePop: true,
  /** A request that arrives live at the shop slides in with an amber glow that fades. */
  newRequestGlow: true,
} as const;

/** The phone or computer asks for less motion (Accessibility → Reduce motion). */
export function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/** Whether an animation runs: its switch is on and the device has not asked for less motion. */
export function motionOn(name: keyof typeof MOTION): boolean {
  return MOTION[name] && !reducedMotion();
}
