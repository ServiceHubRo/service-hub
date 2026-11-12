import { PageHeader } from '../../components/PageHeader';
import { useI18n } from '../../i18n/context';
import { HelpCenterHome } from './HelpCenterHome';
import styles from './help.module.css';

/** The agent's Help Center (A4): every published article, with „Pentru” to see what a group of readers sees. */
export function SupportHelpScreen() {
  const { t } = useI18n();
  return (
    <div className={styles.page}>
      <PageHeader title={t('help.center.title')} subtitle={t('help.center.sub')} />
      <HelpCenterHome role="support" />
    </div>
  );
}
