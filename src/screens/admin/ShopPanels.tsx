import { useState } from 'react';
import { ActionButton } from '../../components/ActionButton';
import { Button } from '../../components/Button';
import { Checkbox } from '../../components/Checkbox';
import { Chip, ChipRow } from '../../components/Chip';
import { Field } from '../../components/Field';
import { InlinePanel } from '../../components/InlinePanel';
import { Stepper } from '../../components/Stepper';
import { TextArea } from '../../components/TextArea';
import {
  extendTrial,
  geocodeShopAsAdmin,
  MANUAL_STATUSES,
  setSubscriptionStatus,
  updateShop,
  type AdminShopDetail,
  type AdminSubscription,
  type BillingEdit,
  type ManualStatus,
  type ShopEdit,
} from '../../data/admin';
import { setSubscriptionPrice } from '../../data/adminTools';
import { canRetryRpc, rpcErrorMessage } from '../../data/rpc';
import { parseNumber } from '../../lib/adminTools';
import { useI18n } from '../../i18n/context';
import type { MessageKey } from '../../i18n/ro';
import { plural } from '../../i18n/translate';
import { stripeRuns } from './format';
import styles from './admin.module.css';

// ------------------------------------------------------------------------------------ free period

export function TrialPanel({ shopId, onDone, onCancel }: { shopId: string; onDone: () => void; onCancel: () => void }) {
  const { t, lang } = useI18n();
  const [days, setDays] = useState(30);
  return (
    <InlinePanel title={t('admin.trial.title')}>
      <p className={styles.muted}>{t('admin.trial.body')}</p>
      <ChipRow label={t('admin.trial.days')}>
        {[7, 30, 90].map((n) => (
          <Chip key={n} selected={days === n} onClick={() => setDays(n)}>
            {plural(lang, 'unit.days', n)}
          </Chip>
        ))}
      </ChipRow>
      <Stepper
        label={t('admin.trial.days')}
        value={days}
        min={1}
        max={365}
        onChange={setDays}
        decreaseLabel={t('common.decrease')}
        increaseLabel={t('common.increase')}
      />
      <div className={styles.panelButtons}>
        <ActionButton
          onAction={async (requestId) => {
            await extendTrial(shopId, days, requestId);
            onDone();
          }}
          errorMessage={(e) => rpcErrorMessage(lang, e)}
          canRetry={canRetryRpc}
        >
          {t('admin.trial.submit', { days: plural(lang, 'unit.days', days) })}
        </ActionButton>
        <Button onClick={onCancel}>{t('common.cancel')}</Button>
      </div>
    </InlinePanel>
  );
}

// ------------------------------------------------------------------------------------ plan status

export function StatusPanel({ detail, onDone, onCancel }: { detail: AdminShopDetail; onDone: () => void; onCancel: () => void }) {
  const { t, lang } = useI18n();
  const current = detail.subscription?.status;
  const options = MANUAL_STATUSES.filter((s) => s !== current);
  const [status, setStatus] = useState<ManualStatus>(options[0]!);
  return (
    <InlinePanel title={t('admin.status.title')}>
      <ChipRow label={t('admin.status.title')}>
        {options.map((s) => (
          <Chip key={s} selected={status === s} onClick={() => setStatus(s)}>
            {t(`admin.subStatus.${s}`)}
          </Chip>
        ))}
      </ChipRow>
      <p className={styles.muted}>{t(`admin.status.explain.${status}`)}</p>
      {stripeRuns(detail.subscription?.stripe_status) && <p className={styles.warning}>{t('admin.status.stripe')}</p>}
      <div className={styles.panelButtons}>
        <ActionButton
          variant={status === 'inactive' || status === 'cancelled' ? 'danger' : 'primary'}
          onAction={async (requestId) => {
            await setSubscriptionStatus(detail.shop.id, status, requestId);
            onDone();
          }}
          errorMessage={(e) => rpcErrorMessage(lang, e)}
          canRetry={canRetryRpc}
        >
          {t('admin.status.submit', { status: t(`admin.subStatus.${status}`) })}
        </ActionButton>
        <Button onClick={onCancel}>{t('common.cancel')}</Button>
      </div>
    </InlinePanel>
  );
}

// ------------------------------------------------------------------------------------ price (T16b)

/**
 * The monthly price of this shop's subscription (e.g. the first shops keep a fixed price). The next
 * Stripe checkout uses it; while Stripe runs a subscription the price stays the one in Stripe.
 */
export function PricePanel({
  shopId,
  subscription,
  onDone,
  onCancel,
}: {
  shopId: string;
  subscription: AdminSubscription;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t, lang } = useI18n();
  const [text, setText] = useState(String(Number(subscription.price_ron)).replace('.', lang === 'ro' ? ',' : '.'));
  const price = parseNumber(text);
  const valid = price !== null && price >= 1 && price <= 10000;
  return (
    <InlinePanel title={t('admin.price.title')}>
      <p className={styles.muted}>{t('admin.price.body')}</p>
      {stripeRuns(subscription.stripe_status) && <p className={styles.warning}>{t('admin.price.stripe')}</p>}
      <Field
        label={t('admin.price.label')}
        value={text}
        inputMode="decimal"
        mono
        error={text.trim() && !valid ? t('admin.price.invalid') : null}
        onChange={(e) => setText(e.target.value)}
      />
      <div className={styles.panelButtons}>
        <ActionButton
          disabled={!valid || stripeRuns(subscription.stripe_status)}
          onAction={async (requestId) => {
            await setSubscriptionPrice(shopId, price!, requestId);
            onDone();
          }}
          errorMessage={(e) => rpcErrorMessage(lang, e)}
          canRetry={canRetryRpc}
        >
          {t('admin.save')}
        </ActionButton>
        <Button onClick={onCancel}>{t('common.cancel')}</Button>
      </div>
    </InlinePanel>
  );
}

// ------------------------------------------------------------------------------------ edit

const TEXT_FIELDS = ['name', 'description', 'street', 'city', 'county', 'postal_code', 'phone', 'phone2', 'website', 'facebook'] as const;
const NUMBER_FIELDS = [
  'year_established',
  'daily_capacity',
  'cars_per_slot',
  'slot_minutes',
  'min_notice_hours',
  'max_advance_days',
  'cancel_deadline_hours',
  'inspection_fee',
] as const;
const BILLING_FIELDS = ['legal_name', 'vat_id', 'reg_com', 'legal_address', 'bank_name', 'iban', 'billing_email', 'legal_rep'] as const;
const MONO = new Set(['postal_code', 'phone', 'phone2', 'vat_id', 'reg_com', 'iban']);

type Values = Record<string, string>;

function initialValues(d: AdminShopDetail): Values {
  const v: Values = {};
  for (const k of [...TEXT_FIELDS, ...NUMBER_FIELDS]) {
    const x = d.shop[k];
    v[k] = x === null || x === undefined ? '' : String(x);
  }
  for (const k of BILLING_FIELDS) v[`billing.${k}`] = d.billing?.[k] ?? '';
  return v;
}

/**
 * "Editează datele" (FR §5.2): the shop's public data, booking rules and fiscal data. Only what
 * changed is sent; the database checks every value (the same rules as the shop's own settings)
 * and names a field it refuses. A new address asks for new map coordinates.
 */
export function EditPanel({ detail, onDone, onCancel }: { detail: AdminShopDetail; onDone: () => void; onCancel: () => void }) {
  const { t, lang } = useI18n();
  const [start] = useState(() => initialValues(detail));
  const [values, setValues] = useState(start);
  const [vatPayer, setVatPayer] = useState(detail.billing?.vat_payer ?? false);
  const set = (k: string, v: string) => setValues((prev) => ({ ...prev, [k]: v }));

  function changes(): { shop: ShopEdit; billing: BillingEdit } | 'invalid' {
    const shop: Record<string, string | number | null> = {};
    const billing: Record<string, string | boolean | null> = {};
    for (const k of TEXT_FIELDS) if (values[k] !== start[k]) shop[k] = values[k]!.trim() || null;
    for (const k of NUMBER_FIELDS) {
      if (values[k] === start[k]) continue;
      const raw = values[k]!.trim().replace(',', '.');
      if (raw === '') {
        shop[k] = null;
        continue;
      }
      const n = Number(raw);
      if (!Number.isFinite(n)) return 'invalid';
      shop[k] = n;
    }
    for (const k of BILLING_FIELDS) if (values[`billing.${k}`] !== start[`billing.${k}`]) billing[k] = values[`billing.${k}`]!.trim() || null;
    if (detail.billing && vatPayer !== detail.billing.vat_payer) billing.vat_payer = vatPayer;
    return { shop: shop as ShopEdit, billing: billing as BillingEdit };
  }

  const field = (k: string, opts: { type?: string; inputMode?: 'numeric' | 'decimal' | 'tel' | 'email' | 'url' } = {}) => {
    const name = k.replace(/^billing\./, '');
    return (
      <Field
        key={k}
        label={t(`admin.field.${name}` as MessageKey)}
        value={values[k] ?? ''}
        onChange={(e) => set(k, e.target.value)}
        mono={MONO.has(name)}
        type={opts.type ?? 'text'}
        inputMode={opts.inputMode}
        autoComplete="off"
      />
    );
  };

  return (
    <InlinePanel title={t('admin.edit.title')}>
      <div className={styles.fields}>
        <h4 className={styles.fieldsTitle}>{t('admin.edit.public')}</h4>
        {field('name')}
        {field('city')}
        {field('street')}
        {field('county')}
        {field('postal_code', { inputMode: 'numeric' })}
        {field('phone', { type: 'tel', inputMode: 'tel' })}
        {field('phone2', { type: 'tel', inputMode: 'tel' })}
        {field('website', { inputMode: 'url' })}
        {field('facebook', { inputMode: 'url' })}
        {field('year_established', { inputMode: 'numeric' })}
        <div className={styles.full}>
          <TextArea
            label={t('admin.field.description')}
            value={values.description ?? ''}
            rows={3}
            onChange={(e) => set('description', e.target.value)}
          />
        </div>
        <h4 className={styles.fieldsTitle}>{t('admin.edit.rules')}</h4>
        {field('daily_capacity', { inputMode: 'numeric' })}
        {field('cars_per_slot', { inputMode: 'numeric' })}
        {field('slot_minutes', { inputMode: 'numeric' })}
        {field('min_notice_hours', { inputMode: 'numeric' })}
        {field('max_advance_days', { inputMode: 'numeric' })}
        {field('cancel_deadline_hours', { inputMode: 'numeric' })}
        {field('inspection_fee', { inputMode: 'decimal' })}
        {detail.billing && (
          <>
            <h4 className={styles.fieldsTitle}>{t('admin.edit.billing')}</h4>
            {field('billing.legal_name')}
            {field('billing.vat_id')}
            {field('billing.reg_com')}
            {field('billing.legal_address')}
            {field('billing.bank_name')}
            {field('billing.iban')}
            {field('billing.billing_email', { type: 'email', inputMode: 'email' })}
            {field('billing.legal_rep')}
            <div className={styles.full}>
              <Checkbox checked={vatPayer} onChange={(e) => setVatPayer(e.target.checked)}>
                {t('admin.field.vat_payer')}
              </Checkbox>
            </div>
          </>
        )}
      </div>
      <div className={styles.panelButtons}>
        <ActionButton
          onAction={async (requestId) => {
            const c = changes();
            if (c === 'invalid') throw new Error('invalid_number');
            const result = await updateShop(detail.shop.id, c.shop, c.billing, requestId);
            if (result.address_changed) void geocodeShopAsAdmin(detail.shop.id);
            onDone();
          }}
          errorMessage={(e) => (e instanceof Error && e.message === 'invalid_number' ? t('admin.edit.number') : rpcErrorMessage(lang, e))}
          canRetry={canRetryRpc}
        >
          {t('common.save')}
        </ActionButton>
        <Button onClick={onCancel}>{t('common.cancel')}</Button>
      </div>
    </InlinePanel>
  );
}
