import { useCallback, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { docNumber } from '../../../../supabase/functions/_shared/jobDoc.ts';
import { BackLink } from '../../../components/BackLink';
import { Card } from '../../../components/Card';
import { Field } from '../../../components/Field';
import { LoadError } from '../../../components/LoadError';
import { SkeletonList } from '../../../components/Skeleton';
import { TextArea } from '../../../components/TextArea';
import { fetchQuoteNumbering, setQuoteNextNumber } from '../../../data/jobDocs';
import { toRpcError } from '../../../data/rpc';
import { fetchBilling, fetchVatRate, updateShop } from '../../../data/shop';
import { useI18n } from '../../../i18n/context';
import { parsePriceBani, priceText } from '../../../lib/quoteDraft';
import { useLoad } from '../../../lib/useLoad';
import { SETTINGS_LINKS, SETTINGS_PATH } from './paths';
import { SaveButton } from './SaveButton';
import { useShopSettings } from './shopSettingsContext';
import styles from './settings.module.css';

const TERMS_MAX = 2000;
const RATE_MAX_BANI = 100_000 * 100;

/**
 * Devize (T50): the hourly rate the quote editor starts labor lines with, the number the next
 * quote gets (a shop moving from paper or another program continues its own series), and the
 * shop's own terms printed at the end of every quote. Whether prices carry VAT comes from Date de
 * facturare. Owner only.
 */
export function QuoteSettings() {
  const { t, lang } = useI18n();
  const { shop, setShop } = useShopSettings();
  const decimal = lang === 'ro' ? ',' : '.';
  const load = useCallback(async () => {
    const [numbering, billing, vatRate] = await Promise.all([fetchQuoteNumbering(), fetchBilling(shop.id), fetchVatRate()]);
    return { numbering, vatPayer: billing?.vat_payer ?? false, vatRate };
  }, [shop.id]);
  const { state, reload, setData } = useLoad(load);
  const [rate, setRate] = useState(() => (shop.labor_rate == null ? '' : priceText(Number(shop.labor_rate), decimal)));
  const [terms, setTerms] = useState(shop.quote_terms ?? '');
  const [next, setNext] = useState<string | null>(null);
  const [rateError, setRateError] = useState<string | null>(null);
  const [numberError, setNumberError] = useState<string | null>(null);
  const rateRef = useRef<HTMLInputElement>(null);
  const numberRef = useRef<HTMLInputElement>(null);

  let body;
  if (state.status === 'loading') body = <SkeletonList count={2} />;
  else if (state.status === 'error') body = <LoadError message={t('qs.loadError')} onRetry={reload} />;
  else {
    const { numbering, vatPayer, vatRate } = state.data;
    const nextText = next ?? String(numbering.next);

    async function save(requestId: string): Promise<boolean> {
      let rateValue: number | null = null;
      if (rate.trim() !== '') {
        const bani = parsePriceBani(rate);
        if (bani === null || bani > RATE_MAX_BANI) {
          setRateError(t('qs.rate.error'));
          rateRef.current?.focus();
          return false;
        }
        rateValue = bani / 100;
      }
      const wanted = Number(nextText.trim());
      if (!/^\d{1,8}$/.test(nextText.trim()) || wanted < 1) {
        setNumberError(t('rpcError.quote_number_invalid'));
        numberRef.current?.focus();
        return false;
      }
      if (wanted !== numbering.next) {
        try {
          await setQuoteNextNumber(wanted, requestId);
        } catch (e) {
          const error = toRpcError(e);
          if (error.code === 'quote_number_used' || error.code === 'quote_number_invalid') {
            setNumberError(
              error.code === 'quote_number_used'
                ? t('rpcError.quote_number_used', { next: docNumber(Number(error.params.next) || numbering.next) })
                : t('rpcError.quote_number_invalid'),
            );
            numberRef.current?.focus();
            return false;
          }
          throw e;
        }
      }
      const saved = await updateShop(shop.id, { labor_rate: rateValue, quote_terms: terms.trim() || null });
      setShop(saved);
      setData((prev) => ({ ...prev, numbering: { ...prev.numbering, next: wanted } }));
      setNext(null);
      return true;
    }

    body = (
      <>
        <Card className={styles.stack}>
          <Field
            ref={rateRef}
            label={vatPayer ? t('qs.rate.vat') : t('qs.rate')}
            hint={t('qs.rate.hint')}
            value={rate}
            inputMode="decimal"
            autoComplete="off"
            mono
            error={rateError}
            onChange={(e) => {
              setRate(e.target.value);
              setRateError(null);
            }}
          />
          <p className={styles.hint}>
            {vatPayer ? t('qs.vat.on', { rate: vatRate }) : t('qs.vat.off')}{' '}
            <Link to={SETTINGS_LINKS.billing} className={styles.inlineLink}>
              {t('settings.billing')}
            </Link>
          </p>
        </Card>
        <Card className={styles.stack}>
          <Field
            ref={numberRef}
            label={t('qs.next')}
            hint={numbering.last != null ? t('qs.next.last', { n: docNumber(numbering.last) }) : t('qs.next.none')}
            value={nextText}
            inputMode="numeric"
            autoComplete="off"
            mono
            error={numberError}
            onChange={(e) => {
              setNext(e.target.value);
              setNumberError(null);
            }}
          />
        </Card>
        <Card className={styles.stack} data-span="all">
          <TextArea
            label={t('qs.terms')}
            hint={t('qs.terms.hint')}
            value={terms}
            maxLength={TERMS_MAX}
            rows={5}
            onChange={(e) => setTerms(e.target.value)}
          />
        </Card>
        <SaveButton onSave={save}>{t('common.save')}</SaveButton>
      </>
    );
  }

  return (
    <div className={styles.page}>
      <BackLink to={SETTINGS_PATH} label={t('settings.title')} />
      <h1>{t('settings.quotes')}</h1>
      <div className={styles.page} data-layout="columns">
        {body}
      </div>
    </div>
  );
}
