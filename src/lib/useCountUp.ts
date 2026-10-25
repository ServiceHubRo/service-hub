import { useEffect, useRef, useState } from 'react';
import { motionOn } from './motion';

const DURATION_MS = 700;

/** Slow at the end: the number settles on its value. */
function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}

/**
 * A whole number that counts up to `target` when it first shows, and from the old value to the
 * new one when it changes (src/lib/motion.ts, countUp). With the switch off, or less motion asked
 * for, it is `target` at once.
 */
export function useCountUp(target: number): number {
  const animate = motionOn('countUp');
  const [shown, setShown] = useState(animate ? 0 : target);
  const from = useRef(animate ? 0 : target);

  useEffect(() => {
    if (!animate) {
      from.current = target;
      return;
    }
    const start = from.current;
    if (start === target) return;
    let frame = 0;
    const began = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - began) / DURATION_MS);
      const value = Math.round(start + (target - start) * easeOut(t));
      from.current = value;
      setShown(value);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [animate, target]);

  return animate ? shown : target;
}
