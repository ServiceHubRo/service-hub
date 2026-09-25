import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ActionButton } from '../../components/ActionButton';
import { BackLink } from '../../components/BackLink';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { LoadError } from '../../components/LoadError';
import { SkeletonList } from '../../components/Skeleton';
import { Stars } from '../../components/Stars';
import { StatusBadge } from '../../components/StatusBadge';
import { deleteAccount, fetchClient, setAccountSuspended } from '../../data/admin';
import { canRetryRpc, rpcErrorMessage, toRpcError } from '../../data/rpc';
import { useI18n } from '../../i18n/context';
import { NO_SHOW_FLAG } from '../../lib/admin';
import { formatPhone } from '../../lib/validators';
import { ConfirmPanel } from './ActionPanels';
import { AuditList, Facts, Money, Pill, RowLink, SectionTitle, Verified } from './parts';
import { ADMIN_CLIENTS_PATH, adminBookingPath, adminBookingsLink, adminThreadPath } from './paths';
import { useLiveData } from './useLiveData';
import { carText, dateTime, day } from './format';
import styles from './admin.module.css';

type Panel = 'suspend' | 'delete' | null;

/**
 * One client for the admin (FR §5.3, P20): profile, cars, bookings, reviews and conversations
 * (read-only), the audit entries; suspend / reactivate and delete. Live.
 */
export function ClientDetailScreen() {
  const { clientId = '' } = useParams();
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const load = useCallback(() => fetchClient(clientId), [clientId]);
  const live = [
    { table: 'profiles', filter: `id=eq.${clientId}` },
    { table: 'bookings', filter: `client_id=eq.${clientId}` },
  ];
  const { state, reload, refetch } = useLiveData(load, live, `admin-client:${clientId}`);
  const [panel, setPanel] = useState<Panel>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const done = (message: string) => {
    setPanel(null);
    setNotice(message);
    void refetch().catch(() => {});
  };

  if (state.status === 'loading') return <SkeletonList />;
  if (state.status === 'error') {
    return (
      <div className={styles.page}>
        <BackLink to={ADMIN_CLIENTS_PATH} label={t('nav.admin.clients')} />
        <LoadError
          message={toRpcError(state.error).code === 'not_found' ? t('admin.client.notFound') : t('admin.loadError')}
          onRetry={reload}
        />
      </div>
    );
  }
  const c = state.data;
  const p = c.profile;

  return (
    <div className={styles.page}>
      <BackLink to={ADMIN_CLIENTS_PATH} label={t('nav.admin.clients')} />

      <Card className={styles.stack}>
        <div className={styles.cardHead}>
          <h1 className={styles.cardTitle}>{p.name || t('admin.noName')}</h1>
          <span className={styles.rowTop}>
            {p.suspended && <Pill tone="red">{t('admin.suspended')}</Pill>}
            {c.no_shows >= NO_SHOW_FLAG && <Pill tone="amber">{t('admin.noShowFlag', { n: c.no_shows })}</Pill>}
          </span>
        </div>
        <span className={styles.id}>{p.display_id}</span>
        <span className={styles.checks}>
          <Verified ok={Boolean(p.email_verified_at)} label={t('admin.email')} />
        </span>
        <Facts
          rows={[
            [t('admin.email'), p.email],
            [t('admin.phone'), p.phone ? <span className="mono">{formatPhone(p.phone)}</span> : null],
            [t('admin.language'), p.lang.toUpperCase()],
            [t('admin.created'), dateTime(lang, p.created_at)],
            [t('admin.lastActiveLabel'), p.last_active_at ? dateTime(lang, p.last_active_at) : t('admin.never')],
            [t('admin.clients.noShowsLabel'), c.no_shows],
            [t('admin.terms'), p.terms_version],
          ]}
        />
      </Card>

      {notice && (
        <p className={styles.muted} role="status">
          {notice}
        </p>
      )}

      <section className={styles.section} aria-labelledby="client-actions">
        <SectionTitle>
          <span id="client-actions">{t('admin.actions')}</span>
        </SectionTitle>
        {panel === null && (
          <div className={styles.actions}>
            {p.suspended ? (
              <ActionButton
                variant="secondary"
                onAction={async (requestId) => {
                  await setAccountSuspended(p.id, false, '', requestId);
                  done(t('admin.done.unsuspendedAccount'));
                }}
                errorMessage={(e) => rpcErrorMessage(lang, e)}
                canRetry={canRetryRpc}
              >
                {t('admin.client.unsuspend')}
              </ActionButton>
            ) : (
              <Button onClick={() => setPanel('suspend')}>{t('admin.client.suspend')}</Button>
            )}
            <Button variant="danger" onClick={() => setPanel('delete')}>
              {t('admin.client.delete')}
            </Button>
          </div>
        )}
        {panel === 'suspend' && (
          <ConfirmPanel
            title={t('admin.client.suspend')}
            body={t('admin.client.suspendBody')}
            textLabel={t('admin.reason')}
            textHint={t('admin.reasonHint')}
            textRequired
            confirmLabel={t('admin.client.suspend')}
            danger
            onConfirm={async (reason, requestId) => {
              await setAccountSuspended(p.id, true, reason, requestId);
              done(t('admin.done.suspendedAccount'));
            }}
            onCancel={() => setPanel(null)}
          />
        )}
        {panel === 'delete' && (
          <ConfirmPanel
            title={t('admin.client.delete')}
            body={t('admin.client.deleteBody')}
            confirmLabel={t('admin.client.deleteConfirm')}
            danger
            onConfirm={async () => {
              await deleteAccount(p.id);
              navigate(ADMIN_CLIENTS_PATH, { replace: true });
            }}
            onCancel={() => setPanel(null)}
          />
        )}
      </section>

      <SectionTitle>{t('admin.client.cars')}</SectionTitle>
      {c.cars.length === 0 ? (
        <p className={styles.muted}>{t('admin.client.noCars')}</p>
      ) : (
        <ul className={styles.list}>
          {c.cars.map((car) => (
            <li key={car.id}>
              <Card>
                <Facts
                  rows={[
                    [t('admin.client.car'), carText(car)],
                    [t('admin.client.plate'), car.plate ? <span className="mono">{car.plate}</span> : null],
                    [t('admin.client.vin'), car.vin ? <span className="mono">{car.vin}</span> : null],
                    ['ITP', car.itp_expiry ? day(lang, car.itp_expiry) : null],
                    ['RCA', car.rca_expiry ? day(lang, car.rca_expiry) : null],
                    [t('admin.client.vignette'), car.vignette_expiry ? day(lang, car.vignette_expiry) : null],
                  ]}
                />
              </Card>
            </li>
          ))}
        </ul>
      )}

      <SectionTitle>{t('admin.client.bookings')}</SectionTitle>
      {c.bookings.length === 0 ? (
        <p className={styles.muted}>{t('admin.noBookings')}</p>
      ) : (
        <>
          <ul className={styles.list}>
            {c.bookings.slice(0, 30).map((b) => (
              <li key={b.id}>
                <RowLink to={adminBookingPath(b.id)}>
                  <span className={styles.rowTop}>
                    <span className={styles.rowTitle}>{(lang === 'ro' ? b.service_ro : b.service_en) ?? ''}</span>
                    <StatusBadge status={b.status} />
                  </span>
                  <span className={styles.rowMeta}>
                    <span className={styles.id}>{b.ref}</span>
                    <span>
                      {day(lang, b.date)}, {b.slot}
                    </span>
                    <span>{b.shop_name}</span>
                    <span>{carText(b.car_snapshot)}</span>
                    {b.cost !== null && <Money amount={b.cost} />}
                  </span>
                </RowLink>
              </li>
            ))}
          </ul>
          {c.bookings.length > 30 && (
            <Link to={adminBookingsLink({ client: p.id })} className={styles.link}>
              {t('admin.allBookings')}
            </Link>
          )}
        </>
      )}

      <SectionTitle>{t('admin.client.reviews')}</SectionTitle>
      {c.reviews.length === 0 ? (
        <p className={styles.muted}>{t('admin.noReviews')}</p>
      ) : (
        <ul className={styles.list}>
          {c.reviews.map((r) => (
            <li key={r.id}>
              <Card className={styles.stack}>
                <div className={styles.rowTop}>
                  <Stars value={r.rating} size={15} />
                  <span className={styles.muted}>
                    {r.shop_name} · {day(lang, r.created_at)}
                  </span>
                  {r.removed_at && <Pill tone="grey">{t('admin.reportStatus.removed')}</Pill>}
                </div>
                {r.text && <p className={styles.quote}>{r.text}</p>}
              </Card>
            </li>
          ))}
        </ul>
      )}

      <SectionTitle>{t('admin.client.threads')}</SectionTitle>
      {c.threads.length === 0 ? (
        <p className={styles.muted}>{t('admin.client.noThreads')}</p>
      ) : (
        <ul className={styles.list}>
          {c.threads.map((th) => (
            <li key={th.id}>
              <RowLink to={adminThreadPath(th.id)}>
                <span className={styles.rowTitle}>{th.shop_name}</span>
                <span className={styles.rowMeta}>
                  <span>{t('admin.client.messages', { n: th.messages })}</span>
                  {th.last_message_at && <span>{dateTime(lang, th.last_message_at)}</span>}
                </span>
              </RowLink>
            </li>
          ))}
        </ul>
      )}

      <SectionTitle>{t('admin.audit.title')}</SectionTitle>
      <AuditList entries={c.audit} />
    </div>
  );
}
