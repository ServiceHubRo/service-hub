import { useI18n } from '../i18n/context';
import styles from './AnpcSal.module.css';

/**
 * ANPC's SAL platform, where the pictogram leads. The old page (anpc.ro/ce-este-sal/) no longer exists: ANPC's
 * placard names the platform, reclamatiisal.anpc.ro (Eduard, 23 Nov 2026).
 */
export const ANPC_SAL_URL = 'https://reclamatiisal.anpc.ro/';

/**
 * The official ANPC pictogram for alternative dispute resolution (SAL), which a site selling to
 * consumers shows where it can be seen (ANPC Order 449/2022): 250 px wide, linking to ANPC. The
 * image is ANPC's own file (cut to its frame, the corners outside it transparent), in Romanian in
 * both languages; the alternative text follows the app.
 */
export function AnpcSal() {
  const { t } = useI18n();
  return (
    <a className={styles.link} href={ANPC_SAL_URL} target="_blank" rel="noopener noreferrer">
      <img className={styles.img} src="/anpc-sal.png" width={250} height={62} alt={t('legal.anpcSal')} />
    </a>
  );
}
