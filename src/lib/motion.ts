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
} as const;

/** The phone or computer asks for less motion (Accessibility → Reduce motion). */
export function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/** Whether an animation runs: its switch is on and the device has not asked for less motion. */
export function motionOn(name: keyof typeof MOTION): boolean {
  return MOTION[name] && !reducedMotion();
}
