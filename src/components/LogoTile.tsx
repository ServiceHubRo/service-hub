import { Wrench } from 'lucide-react';
import styles from './LogoTile.module.css';

/**
 * Brand mark (docs/brand/GHID_BRAND.md §2): amber square, corners ~23 % of the width,
 * black #151515 Lucide wrench at ~55 % of the width, stroke 2.5.
 * The wrench color comes from CSS (`color` → `currentColor`), never from an SVG attribute:
 * some browsers (Safari) do not resolve `var(--ink)` inside `stroke="…"` and fall back to white.
 */
export function LogoTile({ size = 28 }: { size?: number | string }) {
  // Any CSS length (the printed poster: `11cqw`): the wrench follows at 55 % through CSS.
  if (typeof size === 'string') {
    return (
      <span
        className={`${styles.tile} ${styles.fluid}`}
        style={{ width: size, height: size, borderRadius: `calc(${size} * 0.23)` }}
        aria-hidden="true"
      >
        <Wrench strokeWidth={2.5} />
      </span>
    );
  }
  return (
    <span className={styles.tile} style={{ width: size, height: size, borderRadius: size * 0.23 }} aria-hidden="true">
      <Wrench size={Math.round(size * 0.55)} strokeWidth={2.5} />
    </span>
  );
}
