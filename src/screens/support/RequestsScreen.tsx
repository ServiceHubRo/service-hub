import { PageHeader } from '../../components/PageHeader';
import { supportListSuggestions, supportSetSuggestionStatus } from '../../data/support';
import { useI18n } from '../../i18n/context';
import { SuggestionsBoard, type AuthorLink } from '../admin/SuggestionsScreen';
import styles from '../admin/admin.module.css';
import { supportAccountPath } from './paths';

/** The author's line opens the account's card (as an agent sees it). */
const authorLink: AuthorLink = (s) => supportAccountPath(s.author_id);

/**
 * Solicitări (A2): the suggestions of clients and shops, the same board as the admin's, through the
 * support_* functions (every change in the audit log). The full request system replaces it in A3.
 */
export function RequestsScreen() {
  const { t } = useI18n();
  return (
    <div className={styles.page}>
      <PageHeader title={t('support.requests.title')} subtitle={t('support.requests.desc')} />
      <SuggestionsBoard load={supportListSuggestions} setStatus={supportSetSuggestionStatus} authorLink={authorLink} />
    </div>
  );
}
