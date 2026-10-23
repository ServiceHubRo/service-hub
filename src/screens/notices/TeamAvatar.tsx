import { Megaphone } from 'lucide-react';
import styles from './notices.module.css';

/** The team's picture in Mesaje: the megaphone on amber. */
export function TeamAvatar({ size = 44 }: { size?: number }) {
  return (
    <span className={styles.avatar} style={{ width: size, height: size }} aria-hidden="true">
      <Megaphone size={Math.round(size * 0.45)} />
    </span>
  );
}
