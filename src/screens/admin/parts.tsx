import { Check, ChevronRight, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { AuditEntry, ShopState, SubscriptionStatus } from '../../data/admin';
import { useI18n } from '../../i18n/context';
import { formatMoney } from '../../i18n/format';
import type { MessageKey } from '../../i18n/ro';
import type { Lang } from '../../i18n/translate';
import { auditChanges } from '../../lib/admin';
import { actionLabel, dateTime } from './format';
import { ro } from '../../i18n/ro';
import styles from './admin.module.css';

type Tone = 'amber' | 'green' | 'blue' | 'red' | 'grey';

const TONE_CLASS: Record<Tone, string> = {
  amber: styles.amber!,
  green: styles.green!,
  blue: styles.blue!,
  red: styles.red!,
  grey: styles.greyPill!,
};

/** Text + color, never color alone (ARCHITECTURE §17). */
export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`${styles.pill} ${TONE_CLASS[tone]}`}>{children}</span>;
}

const SHOP_TONE: Record<ShopState, Tone> = { active: 'green', trial: 'blue', inactive: 'amber', suspended: 'red', deleted: 'grey' };

export function ShopStatePill({ state }: { state: ShopState }) {
  const { t } = useI18n();
  return <Pill tone={SHOP_TONE[state]}>{t(`admin.shopState.${state}`)}</Pill>;
}

const SUB_TONE: Record<SubscriptionStatus, Tone> = { trial: 'blue', active: 'green', past_due: 'amber', cancelled: 'grey', inactive: 'red' };

export function SubscriptionPill({ status }: { status: SubscriptionStatus }) {
  const { t } = useI18n();
  return <Pill tone={SUB_TONE[status]}>{t(`admin.subStatus.${status}`)}</Pill>;
}

/** "Email confirmat" / "Telefon neconfirmat", with a mark and the words. */
export function Verified({ ok, label }: { ok: boolean; label: string }) {
  const { t } = useI18n();
  return (
    <span className={`${styles.check} ${ok ? styles.ok : styles.no}`}>
      {ok ? <Check size={14} aria-hidden="true" /> : <X size={14} aria-hidden="true" />}
      {t(ok ? 'admin.verified' : 'admin.unverified', { what: label })}
    </span>
  );
}

/** A labelled list of values. */
export function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className={styles.facts}>
      {rows.map(([label, value]) => (
        <div key={label} style={{ display: 'contents' }}>
          <dt>{label}</dt>
          <dd>{value === null || value === undefined || value === '' ? '—' : value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className={styles.sectionTitle}>{children}</h2>;
}

/** A list row that opens a detail screen. */
export function RowLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className={styles.row}>
      <span className={styles.rowMain}>{children}</span>
      <ChevronRight size={18} className={styles.chevron} aria-hidden="true" />
    </Link>
  );
}

export function Money({ amount }: { amount: number | null | undefined }) {
  const { lang } = useI18n();
  return <span className={styles.money}>{amount === null || amount === undefined ? '—' : formatMoney(lang, Number(amount))}</span>;
}

// ------------------------------------------------------------------------------------ audit log

function fieldLabel(t: (key: MessageKey) => string, key: string): string {
  const own = `admin.field.${key.replace(/^billing\./, '')}`;
  return own in ro ? t(own as MessageKey) : key;
}

function valueText(t: (key: MessageKey) => string, lang: Lang, key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return t(value ? 'admin.yes' : 'admin.no');
  if (key === 'status') {
    const status = `admin.subStatus.${String(value)}`;
    const booking = `status.${String(value)}`;
    if (status in ro) return t(status as MessageKey);
    if (booking in ro) return t(booking as MessageKey);
  }
  if (key === 'report_status' && `admin.reportStatus.${String(value)}` in ro) return t(`admin.reportStatus.${String(value)}` as MessageKey);
  if (key === 'mode' && `admin.deleteMode.${String(value)}` in ro) return t(`admin.deleteMode.${String(value)}` as MessageKey);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) return dateTime(lang, value);
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/** Audit entries with who, when, and every value before → after. */
export function AuditList({ entries, entityLink }: { entries: AuditEntry[]; entityLink?: (e: AuditEntry) => ReactNode }) {
  const { t, lang } = useI18n();
  if (entries.length === 0) return <p className={styles.muted}>{t('admin.audit.empty')}</p>;
  return (
    <ul className={styles.audit}>
      {entries.map((e) => {
        const { changes, details } = auditChanges(e);
        return (
          <li key={e.id} className={styles.auditItem}>
            <div className={styles.auditHead}>
              <span className={styles.auditAction}>{actionLabel(t, e.action)}</span>
              <span className={styles.muted}>{dateTime(lang, e.created_at)}</span>
            </div>
            {entityLink?.(e)}
            <span className={styles.muted}>
              {t('admin.audit.by', { admin: [e.admin_display_id, e.admin_name].filter(Boolean).join(' · ') || '—' })}
            </span>
            {changes.map((c) =>
              c.after === undefined ? (
                // Only a "before" (who a deleted account was): no arrow.
                <span key={c.key} className={styles.change}>
                  <span className={styles.changeKey}>{fieldLabel(t, c.key)}: </span>
                  {valueText(t, lang, c.key, c.before)}
                </span>
              ) : (
                <span key={c.key} className={styles.change}>
                  <span className={styles.changeKey}>{fieldLabel(t, c.key)}: </span>
                  {c.before !== undefined && (
                    <>
                      {valueText(t, lang, c.key, c.before)}
                      <span className={styles.arrow} aria-hidden="true">
                        →
                      </span>
                      <span className="visually-hidden">{t('admin.audit.becomes')}</span>
                    </>
                  )}
                  {valueText(t, lang, c.key, c.after)}
                </span>
              ),
            )}
            {details.map((d) => (
              <span key={d.key} className={styles.change}>
                <span className={styles.changeKey}>{t(`admin.audit.detail.${d.key}` as MessageKey)}: </span>
                {valueText(t, lang, d.key, d.after ?? d.before)}
              </span>
            ))}
          </li>
        );
      })}
    </ul>
  );
}
