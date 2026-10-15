import { useCountUp } from '../lib/useCountUp';

/**
 * A figure that counts up to its value (src/lib/motion.ts, countUp); `format` writes it (money,
 * km). The last frame is the exact value, decimals included.
 */
export function CountUp({ value, format = String }: { value: number; format?: (n: number) => string }) {
  const whole = Math.round(value);
  const n = useCountUp(whole);
  return <>{format(n === whole ? value : n)}</>;
}
