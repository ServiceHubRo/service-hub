import { Wrench } from 'lucide-react';
import styles from './LogoTile.module.css';

/** Amber rounded square with the black Lucide wrench (brand mark). */
export function LogoTile({ size = 28 }: { size?: number }) {
  return (
    <span className={styles.tile} style={{ width: size, height: size, borderRadius: size * 0.25 }} aria-hidden="true">
      <Wrench size={Math.round(size * 0.57)} strokeWidth={2.5} color="var(--ink)" />
    </span>
  );
}
