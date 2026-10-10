import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { BackLink } from '../../../components/BackLink';
import { Card } from '../../../components/Card';
import { CheckMenu } from '../../../components/CheckMenu';
import { Field } from '../../../components/Field';
import { SelectField } from '../../../components/SelectField';
import { Stepper } from '../../../components/Stepper';
import { Switch } from '../../../components/Switch';
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
/** What a switched-on offer starts at. */
const DEFAULT_OFFER = 10;

/** Two names in full, more as a count ("3 servicii"). */
function listOrCount(names: string[], count: string): string {
  return names.length <= 2 ? names.join(', ') : count;
}
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
        <SelectField
          label={t('rules.slot')}
          value={String(rules.slot_minutes)}
          options={[30, 60].map((m) => ({ value: String(m), label: t('rules.slot.value', { n: m }) }))}
          onChange={(e) => set('slot_minutes', Number(e.target.value))}
        />
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
        <Switch checked={rules.instant} hint={t('rules.instant.hint')} onChange={(e) => set('instant', e.target.checked)}>
          {t('rules.instant')}
        </Switch>
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
        <div className={own.offer}>
          <Switch
            checked={rules.offer !== null}
            hint={t('rules.offer.hint')}
            onChange={(e) => {
              setOfferError(null);
              set('offer', e.target.checked ? DEFAULT_OFFER : null);
            }}
          >
            {t('rules.offer')}
          </Switch>
          {rules.offer !== null && (
            <>
              <SelectField
                label={t('rules.offer.percent')}
                value={String(rules.offer)}
                options={OFFERS.map((n) => ({ value: String(n), label: t('rules.offer.value', { n }) }))}
                onChange={(e) => set('offer', Number(e.target.value))}
              />
              <Field
                type="date"
                label={t('rules.offer.until')}
                hint={t('rules.offer.untilHint')}
                min={ymdInBucharest(new Date())}
                value={rules.offerUntil}
                onChange={(e) => set('offerUntil', e.target.value)}
              />
              {services.status === 'ready' && (
                <CheckMenu
                  label={t('rules.offer.scope')}
                  summary={
                    rules.offerServices === null
                      ? t('rules.offer.scope.all')
                      : rules.offerServices.length === 0
                        ? t('rules.offer.scope.pick')
                        : listOrCount(
                            services.data.filter((x) => rules.offerServices!.includes(x.id)).map((x) => (lang === 'ro' ? x.name_ro : x.name_en)),
                            plural(lang, 'unit.services', rules.offerServices.length),
                          )
                  }
                  all={{
                    label: t('rules.offer.scope.all'),
                    selected: rules.offerServices === null,
                    onSelect: () => {
                      setOfferError(null);
                      set('offerServices', rules.offerServices === null ? [] : null);
                    },
                  }}
                  options={services.data.map((x) => ({ value: x.id, label: lang === 'ro' ? x.name_ro : x.name_en }))}
                  selected={rules.offerServices ?? []}
                  onToggle={(id) => {
                    setOfferError(null);
                    const now = rules.offerServices ?? [];
                    set('offerServices', now.includes(id) ? now.filter((x) => x !== id) : [...now, id]);
                  }}
                  error={offerError === 'services' ? t('rules.offer.scopeEmpty') : null}
                />
              )}
            </>
          )}
        </div>
      </Card>

      <Card>
        <div className={own.offer}>
          <Switch
            checked={rules.quiet !== null}
            hint={t('rules.quiet.hint')}
            onChange={(e) => {
              setOfferError(null);
              set('quiet', e.target.checked ? DEFAULT_OFFER : null);
            }}
          >
            {t('rules.quiet')}
          </Switch>
          {rules.quiet !== null && (
            <>
              <SelectField
                label={t('rules.offer.percent')}
                value={String(rules.quiet)}
                options={OFFERS.map((n) => ({ value: String(n), label: t('rules.offer.value', { n }) }))}
                onChange={(e) => set('quiet', Number(e.target.value))}
              />
              <CheckMenu
                label={t('rules.quiet.days')}
                summary={
                  rules.quietDays.length === 0
                    ? t('rules.quiet.daysPick')
                    : WEEK.filter((d) => rules.quietDays.includes(d))
                        .map((d) => t(`weekday.${d}` as MessageKey))
                        .join(', ')
                }
                options={WEEK.map((d) => ({ value: String(d), label: t(`weekday.${d}` as MessageKey) }))}
                selected={rules.quietDays.map(String)}
                onToggle={(value) => {
                  setOfferError(null);
                  const d = Number(value);
                  set('quietDays', rules.quietDays.includes(d) ? rules.quietDays.filter((x) => x !== d) : [...rules.quietDays, d].sort((x, y) => x - y));
                }}
                error={offerError === 'days' ? t('rules.quiet.daysRequired') : null}
              />
            </>
          )}
        </div>
      </Card>

      <SaveButton onSave={save}>{t('rules.save')}</SaveButton>
    </div>
  );
}
