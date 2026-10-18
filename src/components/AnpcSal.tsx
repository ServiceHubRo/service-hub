import { useI18n } from '../i18n/context';
import styles from './AnpcSal.module.css';

/** ANPC's page on alternative dispute resolution, where the pictogram must lead. */
export const ANPC_SAL_URL = 'https://anpc.ro/ce-este-sal/';

/**
 * The official ANPC pictogram for alternative dispute resolution (SAL), which a site selling to
 * consumers shows where it can be seen (ANPC Order 449/2022): 250 px wide, linking to ANPC. The
 * image is ANPC's own file, in Romanian in both languages; the alternative text follows the app.
 */
export function AnpcSal() {
  const { t } = useI18n();
  return (
    <a className={styles.link} href={ANPC_SAL_URL} target="_blank" rel="noopener noreferrer">
      <img className={styles.img} src="/anpc-sal.png" width={250} height={61} alt={t('legal.anpcSal')} />
    </a>
  );
}
