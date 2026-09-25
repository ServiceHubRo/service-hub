import { ChevronRight, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import styles from './Tile.module.css';

interface TileProps {
  icon: LucideIcon;
  label: string;
  hint?: string;
  /** A screen of the app… */
  to?: string;
  /** …or an address outside it (mailto:, WhatsApp). */
  href?: string;
}

/** Full-width navigation card: amber icon, label (and an optional muted line), chevron (Cont tiles, P13b). */
export function Tile({ to, href, icon: Icon, label, hint }: TileProps) {
  const inner = (
    <>
      <Icon size={20} className={styles.icon} aria-hidden="true" />
      <span className={styles.label}>
        {label}
        {hint && <span className={styles.hint}>{hint}</span>}
      </span>
      <ChevronRight size={18} className={styles.chevron} aria-hidden="true" />
    </>
  );
  if (href !== undefined) {
    return (
      <a href={href} className={styles.tile} target={href.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer">
        {inner}
      </a>
    );
  }
  return (
    <Link to={to ?? '/'} className={styles.tile}>
      {inner}
    </Link>
  );
}
