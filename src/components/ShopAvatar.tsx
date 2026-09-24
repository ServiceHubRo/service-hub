import { useState } from 'react';
import styles from './ShopAvatar.module.css';

/** First letters of the first two words: "Atelier Demo" → "AD". */
function shopInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

/** The shop's logo, or its initials when it has none (or the image fails to load). Decorative. */
export function ShopAvatar({ name, logoUrl, size = 44 }: { name: string; logoUrl: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.36) };
  if (logoUrl && !broken) {
    return <img src={logoUrl} alt="" className={styles.logo} style={style} loading="lazy" onError={() => setBroken(true)} />;
  }
  return (
    <span className={styles.initials} style={style} aria-hidden="true">
      {shopInitials(name)}
    </span>
  );
}
