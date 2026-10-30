import styles from './KeepHyphens.module.css';

// A word with a hyphen between letters, with what sticks to it: „service-uri”, „Service-Hub.”, „s-a”.
const HYPHENATED = /(\S*\p{L}-\p{L}\S*)/u;

/**
 * Text whose hyphenated words never break at the hyphen („Service-” on one line, „uri” on the
 * next): each such word stays whole on its line (Eduard, 30 Oct 2026). The text itself is unchanged.
 */
export function KeepHyphens({ children }: { children: string }) {
  const parts = children.split(HYPHENATED);
  if (parts.length === 1) return children;
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <span key={i} className={styles.keep}>
        {part}
      </span>
    ) : (
      part
    ),
  );
}
