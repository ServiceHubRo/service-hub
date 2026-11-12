import { AlertTriangle, ArrowUpRight, Ban, ChevronRight, ShieldAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Procedure, ProcedureContent, VersionStatus } from '../../data/procedures';
import { useI18n } from '../../i18n/context';
import { procedureTitle } from '../../lib/procedures';
import { ArticleBody } from '../help/parts';
import styles from './procedures.module.css';

/** A label next to a title: text and color together (never color alone). */
export function Tag({ tone, children }: { tone?: 'critical' | 'amber' | 'green'; children: ReactNode }) {
  const cls = tone === 'critical' ? styles.tagCritical : tone === 'amber' ? styles.tagAmber : tone === 'green' ? styles.tagGreen : '';
  return <span className={`${styles.tag} ${cls}`}>{children}</span>;
}

/** The labels of a procedure: kind, critical, its state when not simply published. */
export function ProcedureTags({ p, showWork = true }: { p: Procedure; showWork?: boolean }) {
  const { t } = useI18n();
  return (
    <>
      <Tag>{t(`proc.kind.${p.kind}`)}</Tag>
      {p.critical && (
        <Tag tone="critical">
          <ShieldAlert size={12} aria-hidden="true" />
          {t('proc.critical')}
        </Tag>
      )}
      {p.status === 'archived' && <Tag>{t('proc.status.archived')}</Tag>}
      {showWork && p.open && <VersionTag status={p.open.status} />}
    </>
  );
}

/** A version in work is a draft or waits for approval: both still need an admin's approval. */
export function VersionTag({ status }: { status: VersionStatus }) {
  const { t } = useI18n();
  if (status === 'approved') return <Tag tone="green">{t('proc.status.approved')}</Tag>;
  return <Tag tone="amber">{status === 'pending' ? t('proc.status.pending') : t('proc.needsApproval')}</Tag>;
}

/** One procedure as a row: title, category, labels, and an optional line under it. */
export function ProcedureRow({ p, to, extra }: { p: Procedure; to: string; extra?: ReactNode }) {
  const { t, lang } = useI18n();
  return (
    <li>
      <Link to={to} className={styles.row}>
        <span className={styles.rowText}>
          <span className={styles.rowTitle}>{procedureTitle(lang, p)}</span>
          <span className={styles.rowMeta}>
            <span>{t(`proc.category.${p.category}`)}</span>
            <ProcedureTags p={p} />
            {p.ack_required && (p.acknowledged_at ? <Tag tone="green">{t('proc.row.confirmed')}</Tag> : <Tag tone="critical">{t('proc.row.toConfirm')}</Tag>)}
            {p.acks && <span>{t('proc.row.acks', { done: p.acks.done, total: p.acks.total })}</span>}
          </span>
          {extra}
        </span>
        <ChevronRight size={18} className={styles.chevron} aria-hidden="true" />
      </Link>
    </li>
  );
}

function Callout({ kind, title, children }: { kind: 'warn' | 'stop' | 'up'; title: string; children: ReactNode }) {
  const Icon = kind === 'warn' ? AlertTriangle : kind === 'stop' ? Ban : ArrowUpRight;
  const cls = kind === 'warn' ? styles.calloutWarn : kind === 'stop' ? styles.calloutStop : styles.calloutUp;
  return (
    <section className={`${styles.callout} ${cls}`} aria-label={title}>
      <Icon size={20} aria-hidden="true" />
      <div className={styles.calloutBody}>
        <h2 className={styles.partTitle}>{title}</h2>
        {children}
      </div>
    </section>
  );
}

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.part} aria-label={title}>
      <h2 className={styles.partTitle}>{title}</h2>
      {children}
    </section>
  );
}

/**
 * A procedure's text, in the order it is used: the warnings first (visible before anything else), when
 * it applies and why, who does what, the numbered steps, the deadlines, when to escalate and what is
 * forbidden. Markdown is read by the app's own reader (never HTML).
 */
export function ProcedureText({ content }: { content: ProcedureContent }) {
  const { t } = useI18n();
  return (
    <div className={styles.reading}>
      {content.warnings && (
        <Callout kind="warn" title={t('proc.page.warnings')}>
          <ArticleBody body={content.warnings} />
        </Callout>
      )}
      <Part title={t('proc.page.appliesWhen')}>
        <ArticleBody body={content.applies_when} />
      </Part>
      <Part title={t('proc.page.purpose')}>
        <ArticleBody body={content.purpose} />
      </Part>
      {content.responsibilities && (
        <Part title={t('proc.page.responsibilities')}>
          <ArticleBody body={content.responsibilities} />
        </Part>
      )}
      <Part title={t('proc.page.steps')}>
        <ol className={styles.steps}>
          {content.steps.map((step, i) => (
            <li key={i} className={styles.step}>
              <div className={styles.stepText}>
                <ArticleBody body={step} />
              </div>
            </li>
          ))}
        </ol>
      </Part>
      {content.deadlines && (
        <Part title={t('proc.page.deadlines')}>
          <ArticleBody body={content.deadlines} />
        </Part>
      )}
      <Callout kind="up" title={t('proc.page.escalation')}>
        <ArticleBody body={content.escalation} />
      </Callout>
      {content.forbidden && (
        <Callout kind="stop" title={t('proc.page.forbidden')}>
          <ArticleBody body={content.forbidden} />
        </Callout>
      )}
    </div>
  );
}
