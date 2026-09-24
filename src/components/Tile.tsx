import { ChevronRight, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import styles from './Tile.module.css';

/** Full-width navigation card: amber icon, label (and an optional muted line), chevron (Cont tiles, P13b). */
export function Tile({ to, icon: Icon, label, hint }: { to: string; icon: LucideIcon; label: string; hint?: string }) {
  return (
    <Link to={to} className={styles.tile}>
      <Icon size={20} className={styles.icon} aria-hidden="true" />
      <span className={styles.label}>
        {label}
        {hint && <span className={styles.hint}>{hint}</span>}
      </span>
      <ChevronRight size={18} className={styles.chevron} aria-hidden="true" />
    </Link>
  );
}
