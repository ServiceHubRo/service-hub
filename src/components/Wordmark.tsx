import styles from './Wordmark.module.css';

/** "SERVICE-" in text color, "HUB" in amber. One component so the colors never drift; never wraps. */
export function Wordmark({ size = 17 }: { size?: number }) {
  return (
    <span className={styles.wordmark} style={{ fontSize: size }} aria-label="Service-Hub" role="img">
      <span aria-hidden="true">SERVICE-</span>
      <span className={styles.hub} aria-hidden="true">
        HUB
      </span>
    </span>
  );
}
