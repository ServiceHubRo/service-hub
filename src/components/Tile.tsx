import { ChevronRight, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import styles from './Tile.module.css';

/** Full-width navigation card: amber icon, label, chevron (Cont tiles, P13b). */
export function Tile({ to, icon: Icon, label }: { to: string; icon: LucideIcon; label: string }) {
  return (
    <Link to={to} className={styles.tile}>
      <Icon size={20} className={styles.icon} aria-hidden="true" />
      <span className={styles.label}>{label}</span>
      <ChevronRight size={18} className={styles.chevron} aria-hidden="true" />
    </Link>
  );
}
