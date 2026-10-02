import { BadgeCheck, Building2 } from 'lucide-react';
import { ActionButton } from '../../components/ActionButton';
import { Banner } from '../../components/Banner';
import { Card } from '../../components/Card';
import type { CompanyCheck } from '../../data/shop';
import { rpcErrorMessage } from '../../data/rpc';
import { useI18n } from '../../i18n/context';
import type { MessageKey } from '../../i18n/ro';
import { formatDayMonth, formatTime } from '../../i18n/format';
import styles from './company.module.css';

/**
 * What ANAF says about the company behind the CUI (T25): the official name, active or not, VAT
 * payer. The owner sees it in Date de facturare (checked after every save), the admin on the
 * shop. Status is told in words, never by color alone. Nothing is blocked automatically.
 */
export function CompanyCheckCard({
  check,
  unavailable,
  vatPayerTyped,
  hasCui,
  onCheck,
}: {
  check: CompanyCheck | null;
  /** ANAF did not answer the last time. */
  unavailable: boolean;
  /** The VAT box as the owner saved it, to point out a difference with ANAF. */
  vatPayerTyped?: boolean;
  hasCui: boolean;
  onCheck: () => Promise<void>;
}) {
  const { t, lang } = useI18n();
  const status = check?.anaf_status ?? null;
  const name = check?.anaf_name ?? '';
  const when = check?.anaf_checked_at ? new Date(check.anaf_checked_at) : null;

  let body;
  if (!hasCui) {
    body = <p className={styles.muted}>{t('company.noCui')}</p>;
  } else if (status === null) {
    body = <p className={styles.muted}>{t('company.notChecked')}</p>;
  } else if (status === 'active' && check?.anaf_name_match !== false) {
    body = (
      <p className={styles.ok}>
        <BadgeCheck size={18} aria-hidden="true" />
        <span>{t('company.active', { name })}</span>
      </p>
    );
  } else if (status === 'active') {
    body = <Banner tone="warning">{t('company.nameMismatch', { name })}</Banner>;
  } else {
    body = <Banner tone="warning">{t(`company.${status}` as MessageKey, { name })}</Banner>;
  }

  const vatDiffers =
    status === 'active' && check?.anaf_vat_payer != null && vatPayerTyped !== undefined && check.anaf_vat_payer !== vatPayerTyped;

  return (
    <Card>
      <section aria-labelledby="company-check-title" className={styles.stack}>
        <h2 id="company-check-title" className={styles.title}>
          <Building2 size={18} aria-hidden="true" />
          {t('company.title')}
        </h2>
        {body}
        {status === 'active' && check?.anaf_address && <p className={styles.muted}>{check.anaf_address}</p>}
        {vatDiffers && (
          <p className={styles.warning}>{t(check!.anaf_vat_payer ? 'company.vatYes' : 'company.vatNo')}</p>
        )}
        {unavailable && <p className={styles.muted} role="status">{t('company.unavailable')}</p>}
        {when && (
          <p className={styles.muted}>
            {t('company.checkedAt', { date: `${formatDayMonth(lang, when)}, ${formatTime(lang, when)}` })}
          </p>
        )}
        {hasCui && (
          <div className={styles.actions}>
            <ActionButton variant="secondary" block={false} onAction={onCheck} errorMessage={(e) => rpcErrorMessage(lang, e)}>
              {t(status === null ? 'company.check' : 'company.recheck')}
            </ActionButton>
          </div>
        )}
      </section>
    </Card>
  );
}
