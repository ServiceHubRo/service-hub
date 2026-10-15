import { useEffect, useRef, useState } from 'react';

/**
 * How many times `value` has grown since the component appeared (not counting the first value).
 * Used as a `key` so an animation plays again at each new increase, and not when it goes down.
 */
export function useBumps(value: number): number {
  const previous = useRef(value);
  const [bumps, setBumps] = useState(0);
  useEffect(() => {
    if (value > previous.current) setBumps((n) => n + 1);
    previous.current = value;
  }, [value]);
  return bumps;
}
