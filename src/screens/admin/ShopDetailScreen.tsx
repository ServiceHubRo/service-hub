import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ActionButton } from '../../components/ActionButton';
import { BackLink } from '../../components/BackLink';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { LoadError } from '../../components/LoadError';
import { SkeletonList } from '../../components/Skeleton';
import { StatusBadge } from '../../components/StatusBadge';
import { Stars } from '../../components/Stars';
import { deleteAccount, fetchShop, setShopSuspended, verifyPhone, type AdminShopDetail } from '../../data/admin';
import { canRetryRpc, rpcErrorMessage, toRpcError } from '../../data/rpc';
import { useI18n } from '../../i18n/context';
import { formatMoney, formatRating } from '../../i18n/format';
import type { MessageKey } from '../../i18n/ro';
import { BOOKING_STATUSES } from '../../lib/status';
import { monthlyAverage } from '../../lib/subscription';
import { formatPhone } from '../../lib/validators';
import { ConfirmPanel } from './ActionPanels';
import { AuditList, Facts, Money, Pill, SectionTitle, ShopStatePill, SubscriptionPill, Verified } from './parts';
import { ADMIN_SHOPS_PATH, adminBookingPath, adminBookingsLink } from './paths';
import { EditPanel, PricePanel, StatusPanel, TrialPanel } from './ShopPanels';
import { useLiveData } from './useLiveData';
import { carText, dateTime, day, stripeRuns } from './format';
import styles from './admin.module.css';

type Panel = 'suspend' | 'trial' | 'status' | 'price' | 'edit' | 'delete' | null;

/**
 * One shop for the admin (FR §5.2, P20): state and why it is hidden, the actions (verify the phone,
 * suspend / reactivate, extend the free period, set the plan status, edit, delete), then the owner,
 * profile, rules, services, fiscal data, subscription and payments, staff, recent bookings,
 * reviews and the audit entries. Live.
 */
export function ShopDetailScreen() {
  const { shopId = '' } = useParams();
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const load = useCallback(() => fetchShop(shopId), [shopId]);
  const live = [
    { table: 'shops', filter: `id=eq.${shopId}` },
    { table: 'subscriptions', filter: `shop_id=eq.${shopId}` },
    { table: 'bookings', filter: `shop_id=eq.${shopId}` },
    { table: 'reviews', filter: `shop_id=eq.${shopId}` },
  ];
  const { state, reload, refetch } = useLiveData(load, live, `admin-shop:${shopId}`);
  const [panel, setPanel] = useState<Panel>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const done = (message: string) => {
    setPanel(null);
    setNotice(message);
    void refetch().catch(() => {});
  };

  if (state.status === 'loading') return <SkeletonList />;
  if (state.status === 'error') {
    const code = toRpcError(state.error).code;
    return (
      <div className={styles.page}>
        <BackLink to={ADMIN_SHOPS_PATH} label={t('nav.admin.shops')} />
        <LoadError message={code === 'shop_not_found' ? t('admin.shop.notFound') : t('admin.loadError')} onRetry={reload} />
      </div>
    );
  }
  const d: AdminShopDetail = state.data;
  const s = d.shop;
  const o = d.owner;
  const sub = d.subscription;
  const deleted = d.state === 'deleted';
  const phoneVerified = Boolean(o.phone_verified_at || o.phone_verified_by_admin);
  const counts = BOOKING_STATUSES.filter((st) => (d.booking_counts[st] ?? 0) > 0);

  return (
    <div className={styles.page}>
      <BackLink to={ADMIN_SHOPS_PATH} label={t('nav.admin.shops')} />

      <Card className={styles.stack}>
        <div className={styles.cardHead}>
          <h1 className={styles.cardTitle}>{s.name}</h1>
          <ShopStatePill state={d.state} />
        </div>
        <span className={styles.rowMeta}>
          <span className={styles.id}>{o.display_id}</span>
          <span>{[s.street, s.city].filter(Boolean).join(', ')}</span>
        </span>
        <span className={styles.checks}>
          <Verified ok={Boolean(o.email_verified_at)} label={t('admin.email')} />
          <Verified ok={phoneVerified} label={t('admin.phone')} />
        </span>
        {d.public ? (
          <p className={styles.muted}>{t('admin.shop.public')}</p>
        ) : (
          <div>
            <p className={styles.warning}>{t('admin.shop.hidden')}</p>
            <ul className={styles.muted} style={{ marginLeft: 18 }}>
              {d.reasons.map((r) => (
                <li key={r}>{t(`admin.reason.${r}` as MessageKey)}</li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {notice && (
        <p className={styles.muted} role="status">
          {notice}
        </p>
      )}

      {!deleted && (
        <section className={styles.section} aria-labelledby="shop-actions">
          <SectionTitle>
            <span id="shop-actions">{t('admin.actions')}</span>
          </SectionTitle>
          {panel === null && (
            <div className={styles.actionGrid}>
              {!phoneVerified && o.phone && (
                <ActionButton
                  variant="secondary"
                  onAction={async (requestId) => {
                    await verifyPhone(o.id, requestId);
                    done(t('admin.done.phone'));
                  }}
                  errorMessage={(e) => rpcErrorMessage(lang, e)}
                  canRetry={canRetryRpc}
                >
                  {t('admin.shop.verifyPhone')}
                </ActionButton>
              )}
              {s.suspended ? (
                <ActionButton
                  variant="secondary"
                  onAction={async (requestId) => {
                    await setShopSuspended(s.id, false, '', requestId);
                    done(t('admin.done.unsuspended'));
                  }}
                  errorMessage={(e) => rpcErrorMessage(lang, e)}
                  canRetry={canRetryRpc}
                >
                  {t('admin.shop.unsuspend')}
                </ActionButton>
              ) : (
                <Button onClick={() => setPanel('suspend')}>{t('admin.shop.suspend')}</Button>
              )}
              <Button onClick={() => setPanel('trial')}>{t('admin.trial.title')}</Button>
              <Button onClick={() => setPanel('status')}>{t('admin.status.title')}</Button>
              {sub && <Button onClick={() => setPanel('price')}>{t('admin.price.title')}</Button>}
              <Button onClick={() => setPanel('edit')}>{t('admin.edit.title')}</Button>
              <Button variant="danger" onClick={() => setPanel('delete')}>
                {t('admin.shop.delete')}
              </Button>
            </div>
          )}
          {panel === 'suspend' && (
            <ConfirmPanel
              title={t('admin.shop.suspend')}
              body={t('admin.shop.suspendBody')}
              textLabel={t('admin.reason')}
              textHint={t('admin.reasonHint')}
              textRequired
              confirmLabel={t('admin.shop.suspend')}
              danger
              onConfirm={async (reason, requestId) => {
                await setShopSuspended(s.id, true, reason, requestId);
                done(t('admin.done.suspended'));
              }}
              onCancel={() => setPanel(null)}
            />
          )}
          {panel === 'trial' && <TrialPanel shopId={s.id} onDone={() => done(t('admin.done.trial'))} onCancel={() => setPanel(null)} />}
          {panel === 'status' && <StatusPanel detail={d} onDone={() => done(t('admin.done.status'))} onCancel={() => setPanel(null)} />}
          {panel === 'price' && sub && (
            <PricePanel shopId={s.id} subscription={sub} onDone={() => done(t('admin.done.price'))} onCancel={() => setPanel(null)} />
          )}
          {panel === 'edit' && <EditPanel detail={d} onDone={() => done(t('admin.done.edit'))} onCancel={() => setPanel(null)} />}
          {panel === 'delete' && (
            <ConfirmPanel
              title={t('admin.shop.delete')}
              body={t('admin.shop.deleteBody')}
              confirmLabel={t('admin.shop.deleteConfirm')}
              danger
              onConfirm={async () => {
                const mode = await deleteAccount(o.id);
                if (mode === 'delete') navigate(ADMIN_SHOPS_PATH, { replace: true });
                else done(t('admin.done.anonymized'));
              }}
              onCancel={() => setPanel(null)}
            />
          )}
        </section>
      )}

      <SectionTitle>{t('admin.shop.owner')}</SectionTitle>
      <Card>
        <Facts
          rows={[
            [t('admin.field.owner_name'), o.name],
            [t('admin.email'), o.email],
            [t('admin.phone'), o.phone ? <span className="mono">{formatPhone(o.phone)}</span> : null],
            [t('admin.language'), o.lang.toUpperCase()],
            [t('admin.created'), dateTime(lang, o.created_at)],
            [t('admin.lastActiveLabel'), o.last_active_at ? dateTime(lang, o.last_active_at) : t('admin.never')],
            [t('admin.accountState'), o.deleted_at ? t('admin.deletedOn', { date: day(lang, o.deleted_at) }) : o.suspended ? t('admin.suspended') : t('admin.accountOk')],
          ]}
        />
      </Card>

      <SectionTitle>{t('admin.shop.profile')}</SectionTitle>
      <Card>
        <Facts
          rows={[
            [t('admin.field.phone'), s.phone ? <span className="mono">{formatPhone(s.phone)}</span> : null],
            [t('admin.field.phone2'), s.phone2 ? <span className="mono">{formatPhone(s.phone2)}</span> : null],
            [t('admin.field.county'), s.county],
            [t('admin.field.postal_code'), s.postal_code],
            [t('admin.field.website'), s.website],
            [t('admin.field.facebook'), s.facebook],
            [t('admin.field.year_established'), s.year_established],
            [t('admin.shop.map'), s.latitude !== null ? t('admin.yes') : t('admin.no')],
            [t('admin.field.description'), s.description],
          ]}
        />
      </Card>

      <SectionTitle>{t('admin.shop.rules')}</SectionTitle>
      <Card className={styles.stack}>
        <Facts
          rows={[
            [t('admin.field.daily_capacity'), s.daily_capacity],
            [t('admin.field.cars_per_slot'), s.cars_per_slot],
            [t('admin.field.slot_minutes'), s.slot_minutes],
            [t('admin.field.min_notice_hours'), s.min_notice_hours],
            [t('admin.field.max_advance_days'), s.max_advance_days],
            [t('admin.field.cancel_deadline_hours'), s.cancel_deadline_hours],
            [t('admin.field.inspection_fee'), <Money key="fee" amount={s.inspection_fee} />],
            [
              t('admin.shop.hours'),
              d.hours
                .map((h) =>
                  h.is_closed
                    ? `${t(`weekday.${h.weekday}` as MessageKey)}: ${t('admin.closed')}`
                    : `${t(`weekday.${h.weekday}` as MessageKey)}: ${h.open_time}–${h.close_time}`,
                )
                .join(' · '),
            ],
            [
              t('admin.shop.closures'),
              d.closures.length === 0 ? null : d.closures.map((c) => `${day(lang, c.start_date)} – ${day(lang, c.end_date)}`).join(', '),
            ],
            [
              t('admin.shop.services'),
              d.services.length === 0 ? null : d.services.map((sv) => (lang === 'ro' ? sv.name_ro : sv.name_en)).join(', '),
            ],
          ]}
        />
      </Card>

      <SectionTitle>{t('admin.shop.billing')}</SectionTitle>
      <Card>
        {d.billing ? (
          <Facts
            rows={[
              [t('admin.field.legal_name'), d.billing.legal_name],
              [t('admin.field.vat_id'), d.billing.vat_id ? <span className="mono">{d.billing.vat_id}</span> : null],
              [t('admin.field.reg_com'), d.billing.reg_com ? <span className="mono">{d.billing.reg_com}</span> : null],
              [t('admin.field.legal_address'), d.billing.legal_address],
              [t('admin.field.vat_payer'), d.billing.vat_payer ? t('admin.yes') : t('admin.no')],
              [t('admin.field.bank_name'), d.billing.bank_name],
              [t('admin.field.iban'), d.billing.iban ? <span className="mono">{d.billing.iban}</span> : null],
              [t('admin.field.billing_email'), d.billing.billing_email],
              [t('admin.field.legal_rep'), d.billing.legal_rep],
            ]}
          />
        ) : (
          <p className={styles.muted}>—</p>
        )}
      </Card>

      <SectionTitle>{t('admin.shop.subscription')}</SectionTitle>
      <Card className={styles.stack}>
        {sub ? (
          <>
            <div className={styles.rowTop}>
              <SubscriptionPill status={sub.status} />
              {sub.cancel_at_period_end && <Pill tone="amber">{t('admin.sub.ending')}</Pill>}
            </div>
            <Facts
              rows={[
                [t('admin.sub.trialEnds'), sub.trial_ends_at ? dateTime(lang, sub.trial_ends_at) : null],
                [t('admin.sub.periodEnd'), sub.current_period_end ? dateTime(lang, sub.current_period_end) : null],
                [t('admin.sub.price'), <Money key="price" amount={sub.price_ron} />],
                [t('admin.sub.seats'), t('admin.sub.seatsValue', { n: sub.seats, price: formatMoney(lang, Number(sub.seat_price_ron)) })],
                [t('admin.sub.monthly'), <Money key="monthly" amount={monthlyAverage(sub)} />],
                [
                  t('admin.sub.period'),
                  sub.billing_months > 1 ? t('admin.subs.period', { n: sub.billing_months, discount: Number(sub.period_discount) }) : null,
                ],
                [t('admin.sub.stripe'), sub.stripe_status],
                [t('admin.sub.customer'), sub.stripe_customer_id ? <span className="mono">{sub.stripe_customer_id}</span> : null],
                [t('admin.sub.paymentFailed'), sub.payment_failed_at ? dateTime(lang, sub.payment_failed_at) : null],
                [t('admin.sub.endedReason'), sub.ended_reason ? t(`admin.endedReason.${sub.ended_reason}` as MessageKey) : null],
              ]}
            />
            {stripeRuns(sub.stripe_status) && <p className={styles.muted}>{t('admin.sub.inStripe')}</p>}
            <h3 className={styles.sectionTitle}>{t('admin.sub.payments')}</h3>
            {d.invoices.length === 0 ? (
              <p className={styles.muted}>{t('admin.sub.noPayments')}</p>
            ) : (
              <ul className={styles.lines}>
                {d.invoices.map((i) => (
                  <li key={i.id} className={styles.line}>
                    <span>
                      {day(lang, i.issued_at)} · {i.provider_ref ?? ''}{' '}
                      {i.receipt_url && (
                        <a className={styles.link} href={i.receipt_url} target="_blank" rel="noreferrer">
                          {t('admin.sub.receipt')}
                        </a>
                      )}
                    </span>
                    <Money amount={i.amount} />
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className={styles.muted}>—</p>
        )}
      </Card>

      <SectionTitle>{t('admin.shop.staff')}</SectionTitle>
      <Card>
        <ul className={styles.lines}>
          {d.staff.map((m) => (
            <li key={m.id} className={styles.line}>
              <span>
                {m.name || m.email || '—'} {m.display_id && <span className={styles.id}>{m.display_id}</span>}
              </span>
              <span className={styles.muted}>
                {m.role === 'owner' ? t('admin.staff.owner') : m.accepted_at ? t('admin.staff.staff') : t('admin.staff.invited')}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <SectionTitle>{t('admin.shop.bookings')}</SectionTitle>
      {counts.length > 0 && (
        <p className={styles.breakdown}>
          {counts.map((st) => (
            <span key={st}>
              {t(`status.${st}`)}: {d.booking_counts[st]}
            </span>
          ))}
        </p>
      )}
      {d.bookings.length === 0 ? (
        <p className={styles.muted}>{t('admin.noBookings')}</p>
      ) : (
        <>
          <ul className={styles.list}>
            {d.bookings.map((b) => (
              <li key={b.id}>
                <Link to={adminBookingPath(b.id)} className={styles.row}>
                  <span className={styles.rowMain}>
                    <span className={styles.rowTop}>
                      <span className={styles.rowTitle}>{(lang === 'ro' ? b.service_ro : b.service_en) ?? ''}</span>
                      <StatusBadge status={b.status} />
                    </span>
                    <span className={styles.rowMeta}>
                      <span className={styles.id}>{b.ref}</span>
                      <span>
                        {day(lang, b.date)}, {b.slot}
                      </span>
                      <span>{b.client_name || t('admin.deletedAccount')}</span>
                      <span>{carText(b.car_snapshot)}</span>
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <Link to={adminBookingsLink({ shop: s.id })} className={styles.link}>
            {t('admin.allBookings')}
          </Link>
        </>
      )}

      <SectionTitle>{t('admin.shop.reviews')}</SectionTitle>
      {d.rating && d.rating.review_count > 0 && d.rating.average !== null && (
        <p className={styles.muted}>
          {formatRating(lang, d.rating.average)} · {t('admin.reviewCount', { n: d.rating.review_count })}
        </p>
      )}
      {d.reviews.length === 0 ? (
        <p className={styles.muted}>{t('admin.noReviews')}</p>
      ) : (
        <ul className={styles.list}>
          {d.reviews.map((r) => (
            <li key={r.id}>
              <Card className={styles.stack}>
                <div className={styles.rowTop}>
                  <Stars value={r.rating} size={15} />
                  <span className={styles.muted}>
                    {r.client_display_name || t('admin.deletedAccount')} · {day(lang, r.created_at)}
                  </span>
                  {r.removed_at ? (
                    <Pill tone="grey">{t('admin.reportStatus.removed')}</Pill>
                  ) : r.report_status ? (
                    <Pill tone={r.report_status === 'pending' ? 'amber' : 'green'}>{t(`admin.reportStatus.${r.report_status}`)}</Pill>
                  ) : null}
                </div>
                {r.text && <p className={styles.quote}>{r.text}</p>}
                {r.reply && <p className={styles.reply}>{r.reply}</p>}
              </Card>
            </li>
          ))}
        </ul>
      )}

      <SectionTitle>{t('admin.audit.title')}</SectionTitle>
      <AuditList entries={d.audit} />
    </div>
  );
}
