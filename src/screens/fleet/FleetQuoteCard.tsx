import { ShieldCheck } from 'lucide-react';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { useI18n } from '../../i18n/context';
import { formatDate, formatMoney } from '../../i18n/format';
import { approvalDecision, jobStage, type FleetJob } from '../../lib/fleet';
import { QuoteDecision } from '../client/bookings/QuoteDecision';
import { JobStagePill } from './FleetPills';
import { useFleet } from './fleetContext';
import styles from './fleet.module.css';

/**
 * One company quote (T63d): its lines and totals — estimate, approved, final, never added up — who
 * decided it, and, while it waits, the company's answer. The admin answers any amount; a manager up
 * to the company's limit, the database refusing more (`fleet_over_limit`); the others read it.
 * The answer is the client's own quote panel (every line ticked, variants, refuse with a confirm),
 * sent through fleet_decide_quote.
 */
export function FleetQuoteCard({ job }: { job: FleetJob }) {
  if (!job.quote) return null;
  return (
    <Card className={styles.card}>
      <div className={styles.cardHead}>
        <h3 className={styles.cardTitle}>
          {job.shop_name} · <span className="mono">{job.ref}</span>
        </h3>
        <JobStagePill stage={jobStage(job)} />
      </div>
      <FleetQuoteBody job={job} />
    </Card>
  );
}

/** The quote without its card: in the vehicle's Devize and inside a booking of Programări. */
export function FleetQuoteBody({ job }: { job: FleetJob }) {
  const { t, lang } = useI18n();
  const { data, mode, actions, allowed } = useFleet();
  const q = job.quote;
  if (!q) return null;
  const money = allowed('costs.view');
  const waiting = job.status === 'quote_sent' && q.status === 'sent';
  // The reader's own limit (else the company's): the database answers it with the overview.
  const limit = data.me.approval_limit !== undefined ? data.me.approval_limit : data.company.manager_approval_limit;
  const decision = approvalDecision(data.me.role, q.total_sent, limit, data.me.extra_caps);
  const decides = waiting && decision !== 'not_allowed';
  const decidedBy =
    q.decided_by_name ?? data.members.find((m) => m.user_id === q.decided_by_member || m.id === q.decided_by_member)?.name ?? null;

  return (
    <div className={styles.quoteBody}>
      {decides && mode === 'live' && actions ? (
        <>
          {data.me.role !== 'admin' && limit !== null && (
            <p className={decision === 'over_limit' ? styles.warnLine : styles.hintLine}>{t('fleet.bk.limitHint', { limit: formatMoney(lang, limit) })}</p>
          )}
          <QuoteDecision
            key={q.id}
            bookingId={job.id}
            quote={q}
            decide={actions.decideQuote}
            act={async (run) => {
              await run();
            }}
          />
        </>
      ) : (
        <>
          <ul className={styles.plainList}>
            {q.items.map((i) => (
              <li key={i.id} className={styles.lineRow}>
                <span className={i.approved === false ? styles.muted : undefined}>
                  {i.name}
                  {i.kind && <span className={styles.muted}> · {t(`fleet.kind.${i.kind}`)}</span>}
                </span>
                {money && <span className="mono">{formatMoney(lang, i.price)}</span>}
              </li>
            ))}
          </ul>
          {money && (
            <dl className={styles.quoteTotals}>
              <div>
                <dt>{t('fleet.quote.estimate')}</dt>
                <dd className="mono">{formatMoney(lang, q.total_sent)}</dd>
              </div>
              <div>
                <dt>{t('fleet.quote.approved')}</dt>
                <dd className="mono">{q.total_approved === null ? '—' : formatMoney(lang, q.total_approved)}</dd>
              </div>
              <div>
                <dt>{t('fleet.quote.final')}</dt>
                <dd className="mono">{job.status === 'done' && job.cost !== null ? formatMoney(lang, job.cost) : '—'}</dd>
              </div>
            </dl>
          )}
          {waiting && (
            <p className={decision === 'allowed' ? styles.note : styles.warnLine}>
              {decision === 'allowed'
                ? t('fleet.quote.canApprove')
                : decision === 'over_limit'
                  ? t('fleet.quote.overLimit', { limit: formatMoney(lang, limit ?? 0) })
                  : t('fleet.quote.cannotApprove')}
            </p>
          )}
          {waiting && decides && mode === 'preview' && (
            <div className={styles.actions}>
              <Button variant="success" disabled title={t('fleet.preview.notSaved')}>
                {t('fleet.quote.approve')}
              </Button>
              <Button variant="danger" disabled title={t('fleet.preview.notSaved')}>
                {t('fleet.quote.refuse')}
              </Button>
            </div>
          )}
        </>
      )}

      {q.decided_at && decidedBy && (
        <p className={styles.hintLine}>
          <ShieldCheck size={14} aria-hidden="true" /> {t('fleet.quote.decidedBy', { name: decidedBy, when: formatDate(lang, new Date(q.decided_at)) })}
        </p>
      )}
    </div>
  );
}
