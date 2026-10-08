import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { BackLink } from '../../../components/BackLink';
import { Card } from '../../../components/Card';
import { Checkbox } from '../../../components/Checkbox';
import { Chip } from '../../../components/Chip';
import { Field } from '../../../components/Field';
import { SelectField } from '../../../components/SelectField';
import { Stepper } from '../../../components/Stepper';
import { fetchCatalog, fetchShopServices, updateShop, type Shop } from '../../../data/shop';
import { useI18n } from '../../../i18n/context';
import type { MessageKey } from '../../../i18n/ro';
import { plural, type Msg } from '../../../i18n/translate';
import { ymdInBucharest } from '../../../i18n/format';
import { useLoad } from '../../../lib/useLoad';
import { SETTINGS_PATH } from './paths';
import { SaveButton } from './SaveButton';
import { useShopSettings } from './shopSettingsContext';
import styles from './settings.module.css';
import own from './RulesSettings.module.css';

const NOTICE_HOURS = [0, 1, 2, 3, 4, 6, 12, 24, 48, 72];
const ADVANCE_DAYS = [7, 14, 21, 30, 45, 60, 90, 180, 365];
const CANCEL_HOURS = [0, 1, 2, 3, 4, 6, 12, 24, 48];
const MAX_FEE = 10000;
/** The discounts a shop can promise new clients (the database allows exactly these). */
const OFFERS = [5, 10, 15];
/** Monday first, as a week reads in Romania (0 = Sunday). */
const WEEK = [1, 2, 3, 4, 5, 6, 0];

/** The preset choices plus the shop's current value when it is not one of them. */
const withCurrent = (presets: number[], current: number) => [...new Set([...presets, current])].sort((a, b) => a - b);

/** "80", "80,5", "80.50" → 80.5; null when it is not an amount in range. */
function parseFee(value: string): number | null {
  const v = value.trim().replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return null;
  const n = Number(v);
  return n >= 0 && n <= MAX_FEE ? n : null;
}

const feeText = (fee: number) => (Number.isInteger(fee) ? String(fee) : fee.toFixed(2));

interface Rules {
  daily_capacity: number;
  cars_per_slot: number;
  slot_minutes: number;
  min_notice_hours: number;
  max_advance_days: number;
  cancel_deadline_hours: number;
  fee: string;
  offer: number | null;
  /** Last day of appointments the offer covers, `YYYY-MM-DD`; '' = no end. */
  offerUntil: string;
  /** The services it covers; null = all. */
  offerServices: string[] | null;
  quiet: number | null;
  quietDays: number[];
  instant: boolean;
}

const toRules = (shop: Shop): Rules => ({
  daily_capacity: shop.daily_capacity,
  cars_per_slot: shop.cars_per_slot,
  slot_minutes: shop.slot_minutes,
  min_notice_hours: shop.min_notice_hours,
  max_advance_days: shop.max_advance_days,
  cancel_deadline_hours: shop.cancel_deadline_hours,
  fee: feeText(shop.inspection_fee),
  offer: shop.new_client_offer,
  offerUntil: shop.new_client_offer_until ?? '',
  offerServices: shop.new_client_offer_services,
  quiet: shop.quiet_day_offer,
  quietDays: shop.quiet_days,
  instant: shop.auto_confirm,
});

/**
 * Reguli de programare (P5, P5b): capacity, cars per slot, slot length, notice, advance, cancellation,
 * fee, the new-client offer (T23) and instant confirmation (T28a).
 */
export function RulesSettings() {
  const { t, lang } = useI18n();
  const { shop, setShop } = useShopSettings();
  const location = useLocation();
  const [rules, setRules] = useState<Rules>(() => toRules(shop));
  const [feeError, setFeeError] = useState<Msg | null>(null);
  const [offerError, setOfferError] = useState<'services' | 'days' | null>(null);
  // The shop's own services, by name, for "Doar la anumite servicii".
  const loadServices = useCallback(async () => {
    const [ids, catalog] = await Promise.all([fetchShopServices(shop.id), fetchCatalog()]);
    return catalog.flatMap((c) => c.services).filter((s) => ids.includes(s.id));
  }, [shop.id]);
  const { state: services } = useLoad(loadServices);
  const capacityRef = useRef<HTMLDivElement>(null);
  const feeRef = useRef<HTMLDivElement>(null);

  // Panou's "Mașini pe zi" and the checklist land straight on the capacity stepper.
  useEffect(() => {
    if (location.hash === '#capacitate') capacityRef.current?.scrollIntoView({ block: 'center' });
  }, [location.hash]);

  function set<K extends keyof Rules>(key: K, value: Rules[K]) {
    setRules((r) => ({ ...r, [key]: value }));
  }

  async function save(): Promise<boolean> {
    const fee = parseFee(rules.fee);
    if (fee === null) {
      setFeeError({ key: 'rules.fee.error' });
      feeRef.current?.querySelector('input')?.focus();
      return false;
    }
    if (rules.offer !== null && rules.offerServices !== null && rules.offerServices.length === 0) {
      setOfferError('services');
      return false;
    }
    if (rules.quiet !== null && rules.quietDays.length === 0) {
      setOfferError('days');
      return false;
    }
    setOfferError(null);
    const saved = await updateShop(shop.id, {
      daily_capacity: rules.daily_capacity,
      cars_per_slot: rules.cars_per_slot,
      slot_minutes: rules.slot_minutes,
      min_notice_hours: rules.min_notice_hours,
      max_advance_days: rules.max_advance_days,
      cancel_deadline_hours: rules.cancel_deadline_hours,
      inspection_fee: fee,
      new_client_offer: rules.offer,
      new_client_offer_until: rules.offer !== null && rules.offerUntil ? rules.offerUntil : null,
      new_client_offer_services: rules.offer !== null ? rules.offerServices : null,
      quiet_day_offer: rules.quiet,
      quiet_days: rules.quiet !== null ? rules.quietDays : [],
      auto_confirm: rules.instant,
      // Checklist step 3; the database stores its own time.
      capacity_reviewed_at: new Date().toISOString(),
    });
    setShop(saved);
    setRules(toRules(saved));
    return true;
  }

  return (
    <div className={styles.page}>
      <BackLink to={SETTINGS_PATH} label={t('settings.title')} />
      <h1>{t('settings.rules')}</h1>
      <p className={styles.intro}>{t('rules.intro')}</p>

      <Card>
        <div id="capacitate" ref={capacityRef} className={own.block}>
          <Stepper
            label={t('rules.capacity')}
            value={rules.daily_capacity}
            min={1}
            max={100}
            onChange={(v) => set('daily_capacity', v)}
            decreaseLabel={t('common.decrease')}
            increaseLabel={t('common.increase')}
          />
          <p className={styles.hint}>{t('rules.capacity.hint')}</p>
        </div>
        <div className={own.block}>
          <Stepper
            label={t('rules.perSlot')}
            value={rules.cars_per_slot}
            min={1}
            max={20}
            onChange={(v) => set('cars_per_slot', v)}
            decreaseLabel={t('common.decrease')}
            increaseLabel={t('common.increase')}
          />
          <p className={styles.hint}>{t('rules.perSlot.hint')}</p>
        </div>
        <div className={own.block} role="group" aria-labelledby="rules-slot">
          <div className={own.inline}>
            <span id="rules-slot">{t('rules.slot')}</span>
            <div className={own.chips}>
              {[30, 60].map((m) => (
                <Chip key={m} selected={rules.slot_minutes === m} onClick={() => set('slot_minutes', m)}>
                  {t('rules.slot.value', { n: m })}
                </Chip>
              ))}
            </div>
          </div>
          <p className={styles.hint}>{t('rules.slot.hint')}</p>
        </div>
      </Card>

      <Card className={styles.stack}>
        <SelectField
          label={t('rules.notice')}
          hint={t('rules.notice.hint')}
          value={String(rules.min_notice_hours)}
          onChange={(e) => set('min_notice_hours', Number(e.target.value))}
          options={withCurrent(NOTICE_HOURS, rules.min_notice_hours).map((h) => ({
            value: String(h),
            label: h === 0 ? t('rules.notice.none') : plural(lang, 'unit.hours', h),
          }))}
        />
        <SelectField
          label={t('rules.advance')}
          hint={t('rules.advance.hint')}
          value={String(rules.max_advance_days)}
          onChange={(e) => set('max_advance_days', Number(e.target.value))}
          options={withCurrent(ADVANCE_DAYS, rules.max_advance_days).map((d) => ({
            value: String(d),
            label: plural(lang, 'unit.days', d),
          }))}
        />
        <SelectField
          label={t('rules.cancel')}
          hint={t('rules.cancel.hint')}
          value={String(rules.cancel_deadline_hours)}
          onChange={(e) => set('cancel_deadline_hours', Number(e.target.value))}
          options={withCurrent(CANCEL_HOURS, rules.cancel_deadline_hours).map((h) => ({
            value: String(h),
            label: h === 0 ? t('rules.cancel.anytime') : t('rules.cancel.before', { hours: plural(lang, 'unit.hours', h) }),
          }))}
        />
      </Card>

      <Card>
        <Checkbox checked={rules.instant} onChange={(e) => set('instant', e.target.checked)} aria-describedby="rules-instant-hint">
          {t('rules.instant')}
        </Checkbox>
        <p id="rules-instant-hint" className={styles.hint}>
          {t('rules.instant.hint')}
        </p>
      </Card>

      <Card>
        <p className={styles.cardTitle}>{t('rules.fee')}</p>
        <p className={`${styles.hint} ${own.feeHint}`}>{t('rules.fee.hint')}</p>
        <div ref={feeRef}>
          <Field
            label={t('rules.fee.label')}
            inputMode="decimal"
            mono
            maxLength={9}
            value={rules.fee}
            onChange={(e) => {
              set('fee', e.target.value);
              setFeeError(null);
            }}
            error={feeError ? t(feeError.key, feeError.params) : null}
          />
        </div>
      </Card>

      <Card>
        <div role="group" aria-labelledby="rules-offer">
          <p id="rules-offer" className={styles.cardTitle}>
            {t('rules.offer')}
          </p>
          <p className={`${styles.hint} ${own.feeHint}`}>{t('rules.offer.hint')}</p>
          <div className={own.offerChips}>
            <Chip selected={rules.offer === null} onClick={() => set('offer', null)}>
              {t('rules.offer.none')}
            </Chip>
            {OFFERS.map((n) => (
              <Chip key={n} selected={rules.offer === n} onClick={() => set('offer', n)}>
                {t('rules.offer.value', { n })}
              </Chip>
            ))}
          </div>
          {rules.offer !== null && (
            <div className={own.offerMore}>
              <Field
                type="date"
                label={t('rules.offer.until')}
                hint={t('rules.offer.untilHint')}
                min={ymdInBucharest(new Date())}
                value={rules.offerUntil}
                onChange={(e) => set('offerUntil', e.target.value)}
              />
              <div role="group" aria-labelledby="rules-offer-scope">
                <p id="rules-offer-scope" className={own.subTitle}>
                  {t('rules.offer.scope')}
                </p>
                <div className={own.offerChips}>
                  <Chip selected={rules.offerServices === null} onClick={() => set('offerServices', null)}>
                    {t('rules.offer.scope.all')}
                  </Chip>
                  <Chip selected={rules.offerServices !== null} onClick={() => set('offerServices', rules.offerServices ?? [])}>
                    {t('rules.offer.scope.some')}
                  </Chip>
                </div>
              </div>
              {rules.offerServices !== null && services.status === 'ready' && (
                <div className={own.serviceList}>
                  {services.data.map((s) => {
                    const on = rules.offerServices!.includes(s.id);
                    return (
                      <Checkbox
                        key={s.id}
                        checked={on}
                        onChange={() => {
                          setOfferError(null);
                          set('offerServices', on ? rules.offerServices!.filter((x) => x !== s.id) : [...rules.offerServices!, s.id]);
                        }}
                      >
                        {lang === 'ro' ? s.name_ro : s.name_en}
                      </Checkbox>
                    );
                  })}
                  {offerError === 'services' && (
                    <p className={own.error} role="alert">
                      {t('rules.offer.scopeEmpty')}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </Card>

      <Card>
        <div role="group" aria-labelledby="rules-quiet">
          <p id="rules-quiet" className={styles.cardTitle}>
            {t('rules.quiet')}
          </p>
          <p className={`${styles.hint} ${own.feeHint}`}>{t('rules.quiet.hint')}</p>
          <div className={own.offerChips}>
            <Chip selected={rules.quiet === null} onClick={() => set('quiet', null)}>
              {t('rules.offer.none')}
            </Chip>
            {OFFERS.map((n) => (
              <Chip key={n} selected={rules.quiet === n} onClick={() => set('quiet', n)}>
                {t('rules.offer.value', { n })}
              </Chip>
            ))}
          </div>
          {rules.quiet !== null && (
            <div role="group" aria-labelledby="rules-quiet-days" className={own.offerMore}>
              <p id="rules-quiet-days" className={own.subTitle}>
                {t('rules.quiet.days')}
              </p>
              <div className={own.offerChips}>
                {WEEK.map((d) => {
                  const on = rules.quietDays.includes(d);
                  return (
                    <Chip
                      key={d}
                      selected={on}
                      onClick={() => {
                        setOfferError(null);
                        set('quietDays', on ? rules.quietDays.filter((x) => x !== d) : [...rules.quietDays, d].sort((a, b) => a - b));
                      }}
                    >
                      {t(`weekday.${d}` as MessageKey)}
                    </Chip>
                  );
                })}
              </div>
              {offerError === 'days' && (
                <p className={own.error} role="alert">
                  {t('rules.quiet.daysRequired')}
                </p>
              )}
            </div>
          )}
        </div>
      </Card>

      <SaveButton onSave={save}>{t('rules.save')}</SaveButton>
    </div>
  );
}
