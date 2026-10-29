import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ActionButton } from '../../../components/ActionButton';
import { BackLink } from '../../../components/BackLink';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { Chip, ChipRow } from '../../../components/Chip';
import { Field } from '../../../components/Field';
import { LoadError } from '../../../components/LoadError';
import { OfferNote } from '../../../components/OfferNote';
import { SelectField } from '../../../components/SelectField';
import { SkeletonList } from '../../../components/Skeleton';
import { TextArea } from '../../../components/TextArea';
import { canRetryRpc, replaceQuote, rpcErrorMessage, sendQuote, toRpcError } from '../../../data/rpc';
import type { ShopBooking } from '../../../data/shopBookings';
import { useI18n } from '../../../i18n/context';
import { formatMoney } from '../../../i18n/format';
import type { MessageKey } from '../../../i18n/ro';
import { plural, type Msg } from '../../../i18n/translate';
import { rowServicesText } from '../../../lib/bookingServices';
import {
  checkDraft,
  convertRows,
  draftTotals,
  parseQuantity,
  priceText,
  quantityText,
  QUOTE_BRAND_MAX,
  QUOTE_NAME_MAX,
  QUOTE_ROWS_MAX,
  rowBani,
  withoutVat,
  type PriceMode,
  type QuoteDraftRow,
  type QuoteLineKind,
  type QuotePartKind,
  type QuoteRowError,
} from '../../../lib/quoteDraft';
import { quoteLines } from '../../../lib/quoteLines';
import { estimateText } from '../../../lib/quoteSections';
import { newRequestId } from '../../../lib/requestId';
import { storage } from '../../../lib/storage';
import { useOfferText } from '../../../lib/useOfferText';
import { shopBookingsLink } from '../paths';
import { useShopBookings } from './shopBookingsContext';
import styles from './quoteEditor.module.css';

const NOTE_MAX = 2000;
/** A VAT payer's choice of typing prices without VAT, kept on this device. */
const NET_KEY = 'sh_quote_net';
/** The estimated times offered, in hours (whole days from 24 on). */
const DURATIONS = [1, 2, 3, 4, 6, 8, 24, 48, 72, 120, 168, 240, 336];

/** A row the editor added with defaults (a quantity of 1, the hourly rate): ignored until named. */
type EditorRow = QuoteDraftRow & { auto?: boolean };

type RowField = 'name' | 'qty' | 'price' | 'brand' | 'altPrice' | 'altBrand';

const ROW_ERROR: Record<QuoteRowError, MessageKey> = {
  name_required: 'sb.quote.error.name_required',
  name_too_long: 'sb.quote.error.name_too_long',
  qty_invalid: 'sb.quote.error.qty_invalid',
  price_required: 'sb.quote.error.price_required',
  price_invalid: 'sb.quote.error.price_invalid',
  line_too_high: 'sb.quote.error.line_too_high',
  alt_price_required: 'sb.quote.error.alt_price_required',
  alt_price_invalid: 'sb.quote.error.alt_price_invalid',
  brand_too_long: 'sb.quote.error.brand_too_long',
};

/** Where a row's error is shown (and the focus goes). */
const ERROR_FIELD: Record<QuoteRowError, RowField> = {
  name_required: 'name',
  name_too_long: 'name',
  qty_invalid: 'qty',
  price_required: 'price',
  price_invalid: 'price',
  line_too_high: 'price',
  alt_price_required: 'altPrice',
  alt_price_invalid: 'altPrice',
  brand_too_long: 'brand',
};

const PART_KINDS: readonly QuotePartKind[] = ['none', 'original', 'alternative', 'both'];
const PART_LABEL: Record<QuotePartKind, MessageKey> = {
  none: 'sb.quote.part.none',
  original: 'sb.quote.part.original',
  alternative: 'sb.quote.part.alternative',
  both: 'sb.quote.part.both',
};

/** The rows of a sent quote, for "Modifică devizul", in the editor's price mode. */
function rowsFromQuote(b: ShopBooking, decimal: ',' | '.', mode: PriceMode): EditorRow[] {
  const show = (gross: number) =>
    priceText((mode.net && mode.vatRate !== null ? withoutVat(Math.round(gross * 100), mode.vatRate) : Math.round(gross * 100)) / 100, decimal);
  return quoteLines(b.quote?.items ?? []).map((line): EditorRow => {
    const item = line.kind === 'plain' ? line.item : line.original;
    const kind: QuoteLineKind = item.kind === 'labor' ? 'labor' : 'part';
    const qty = item.quantity != null ? quantityText(item.quantity, decimal) : '';
    const unit = (i: typeof item) => show(i.quantity != null && i.unit_price != null ? i.unit_price : i.price);
    const base: EditorRow = { key: newRequestId(), kind, name: item.name, qty, price: unit(item), brand: item.brand ?? '' };
    if (line.kind === 'plain') return { ...base, part: kind === 'part' ? (item.variant ?? 'none') : undefined };
    return { ...base, part: 'both', altPrice: unit(line.alternative), altBrand: line.alternative.brand ?? '' };
  });
}

/**
 * The quote editor (T50), on its own screen: labor (hours × hourly rate, or a fixed price) and parts
 * and materials (producer, quantity × unit price, original or alternative part), the estimated
 * time, a note, and the totals with VAT for a VAT payer. Prices may be typed with or without VAT;
 * what is sent includes it. "Modifică devizul" starts from the version the client has and sends a
 * new one in its place. The database checks every line again (`clean_quote_lines`).
 */
export function QuoteEditorScreen() {
  const { bookingId = '' } = useParams();
  const { t } = useI18n();
  const { state, reload } = useShopBookings();
  const back = shopBookingsLink({ tab: 'programate', booking: bookingId });

  let body;
  if (state.status === 'loading') body = <SkeletonList count={3} />;
  else if (state.status === 'error') body = <LoadError message={t('sb.loadError')} onRetry={reload} />;
  else {
    const booking = state.data.bookings.find((b) => b.id === bookingId);
    if (!booking || (booking.status !== 'in_inspection' && booking.status !== 'quote_sent'))
      body = <p className={styles.muted}>{t('qe.unavailable')}</p>;
    else
      body = (
        <Editor
          key={`${booking.id}-${booking.quote?.id ?? ''}`}
          booking={booking}
          fee={state.data.shop.inspection_fee}
          expiryDays={state.data.quote_expiry_days}
          laborRate={state.data.shop.labor_rate ?? null}
          vatRate={state.data.shop.vat_rate ?? null}
          back={back}
        />
      );
  }
  return (
    <div className={styles.page}>
      <BackLink to={back} label={t('nav.bookings')} />
      {body}
    </div>
  );
}

function Editor({
  booking: b,
  fee,
  expiryDays,
  laborRate,
  vatRate,
  back,
}: {
  booking: ShopBooking;
  fee: number;
  expiryDays: number;
  laborRate: number | null;
  vatRate: number | null;
  back: string;
}) {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const { apply, refresh } = useShopBookings();
  const offerText = useOfferText();
  const decimal = lang === 'ro' ? ',' : '.';
  const mode: 'send' | 'replace' = b.status === 'quote_sent' ? 'replace' : 'send';
  const [net, setNet] = useState(() => vatRate !== null && storage.get(NET_KEY) === '1');
  const priceMode: PriceMode = { net: net && vatRate !== null, vatRate };

  const rateText = (asNet: boolean) =>
    laborRate === null
      ? ''
      : priceText((asNet && vatRate !== null ? withoutVat(Math.round(laborRate * 100), vatRate) : Math.round(laborRate * 100)) / 100, decimal);
  const blank = (kind: QuoteLineKind, asNet = priceMode.net): EditorRow =>
    kind === 'labor'
      ? { key: newRequestId(), kind, name: '', qty: '1', price: rateText(asNet), auto: true }
      : { key: newRequestId(), kind, name: '', qty: '1', price: '', part: 'none', brand: '', auto: true };

  const [rows, setRows] = useState<EditorRow[]>(() =>
    mode === 'replace' ? rowsFromQuote(b, decimal, priceMode) : [blank('labor'), blank('part')],
  );
  const [estHours, setEstHours] = useState(() => (mode === 'replace' && b.quote?.est_hours ? String(b.quote.est_hours) : ''));
  const [note, setNote] = useState(() => (mode === 'replace' ? (b.quote?.note ?? '') : ''));
  const [errors, setErrors] = useState<Record<string, QuoteRowError>>({});
  const [formError, setFormError] = useState<Msg | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const focusRow = useRef<{ key: string; field: RowField } | null>(null);

  // Focus the row just added, or the first row with an error (never the top of the page).
  useEffect(() => {
    const target = focusRow.current;
    if (!target) return;
    focusRow.current = null;
    container.current?.querySelector<HTMLInputElement>(`[data-row="${target.key}"][data-field="${target.field}"]`)?.focus();
  });

  /** Rows that count: a row the editor prefilled is ignored until it has a name. */
  const live = useMemo(() => rows.filter((r) => !(r.auto && r.name.trim() === '')), [rows]);
  const totals = draftTotals(live, priceMode);
  const services = rowServicesText(lang, b);
  const car = [b.car_snapshot.make, b.car_snapshot.model, b.car_snapshot.year].filter(Boolean).join(' ');

  function clearError(key: string) {
    if (!errors[key]) return;
    setErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function update(key: string, field: RowField, value: string) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, [field]: value, auto: field === 'name' ? r.auto : false } : r)));
    clearError(key);
    setFormError(null);
  }

  function setPart(key: string, part: QuotePartKind) {
    if (part === 'both') focusRow.current = { key, field: 'altPrice' };
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, part, altPrice: r.altPrice ?? '', altBrand: r.altBrand ?? '' } : r)));
    clearError(key);
  }

  function addRow(kind: QuoteLineKind) {
    const row = blank(kind);
    focusRow.current = { key: row.key, field: 'name' };
    setRows((prev) => {
      // A new line goes after the last line of its kind.
      const last = prev.map((r) => r.kind).lastIndexOf(kind);
      return last < 0 ? [...prev, row] : [...prev.slice(0, last + 1), row, ...prev.slice(last + 1)];
    });
  }

  function removeRow(key: string) {
    setRows((prev) => {
      const index = prev.findIndex((r) => r.key === key);
      const kind = prev[index]?.kind ?? 'labor';
      const next = prev.filter((r) => r.key !== key);
      const same = next.filter((r) => r.kind === kind);
      if (same.length === 0) {
        const row = blank(kind);
        focusRow.current = { key: row.key, field: 'name' };
        return [...next, row].sort((a, z) => (a.kind === z.kind ? 0 : a.kind === 'labor' ? -1 : 1));
      }
      const neighbour = same[Math.min(same.length - 1, Math.max(0, next.slice(0, index).filter((r) => r.kind === kind).length))]!;
      focusRow.current = { key: neighbour.key, field: 'name' };
      return next;
    });
    clearError(key);
  }

  function switchMode(toNet: boolean) {
    if (vatRate === null || toNet === priceMode.net) return;
    setRows((prev) => convertRows(prev, toNet, vatRate, decimal) as EditorRow[]);
    setNet(toNet);
    storage.set(NET_KEY, toNet ? '1' : '0');
  }

  async function submit(requestId: string) {
    const checked = checkDraft(live, priceMode);
    const firstBad = live.find((r) => checked.errors[r.key]);
    if (firstBad) {
      setErrors(checked.errors);
      focusRow.current = { key: firstBad.key, field: ERROR_FIELD[checked.errors[firstBad.key]!] };
      return;
    }
    if (checked.items.length === 0 || totals.total <= 0) {
      setFormError({ key: 'rpcError.quote_total_zero' });
      return;
    }
    const text = note.trim() || undefined;
    const hours = estHours ? Number(estHours) : undefined;
    try {
      const row =
        mode === 'send'
          ? await sendQuote(b.id, checked.items, text, hours, requestId)
          : await replaceQuote(b.id, checked.items, text, hours, requestId);
      apply(row);
      navigate(back, { replace: true });
    } catch (e) {
      const code = toRpcError(e).code;
      if (code === 'wrong_status' || code === 'booking_not_found') refresh();
      throw e;
    }
  }

  const unitLabel = (kind: QuoteLineKind, row: EditorRow) =>
    row.qty.trim() === '' ? t('qe.fixed') : kind === 'labor' ? t('qe.rate') : t('qe.unit');

  const renderRow = (row: EditorRow, n: number) => {
    const error = errors[row.key];
    const errorAt = (field: RowField) => (error && ERROR_FIELD[error] === field ? t(ROW_ERROR[error]) : null);
    const amount = rowBani(row, priceMode) / 100;
    const qty = row.qty.trim() === '' ? null : parseQuantity(row.qty);
    const isPart = row.kind === 'part';
    const part = row.part ?? 'none';
    const altBani = part === 'both' && row.altPrice ? rowBani({ ...row, price: row.altPrice }, priceMode) : 0;
    return (
      <li key={row.key} className={styles.line}>
        <div className={`${styles.grid} ${isPart ? styles.partGrid : styles.laborGrid}`}>
          <Field
            className={styles.name}
            label={isPart ? t('qe.part') : t('qe.operation')}
            value={row.name}
            maxLength={QUOTE_NAME_MAX}
            autoComplete="off"
            error={errorAt('name')}
            onChange={(e) => update(row.key, 'name', e.target.value)}
            data-row={row.key}
            data-field="name"
          />
          {isPart && (
            <Field
              className={styles.producer}
              label={t('qe.producer')}
              value={row.brand ?? ''}
              maxLength={QUOTE_BRAND_MAX}
              autoComplete="off"
              error={errorAt('brand')}
              onChange={(e) => update(row.key, 'brand', e.target.value)}
              data-row={row.key}
              data-field="brand"
            />
          )}
          <Field
            className={styles.qty}
            label={isPart ? t('qe.qty') : t('qe.hours')}
            value={row.qty}
            inputMode="decimal"
            autoComplete="off"
            mono
            error={errorAt('qty')}
            onChange={(e) => update(row.key, 'qty', e.target.value)}
            data-row={row.key}
            data-field="qty"
          />
          <Field
            className={styles.price}
            label={unitLabel(row.kind, row)}
            value={row.price}
            inputMode="decimal"
            autoComplete="off"
            mono
            error={errorAt('price')}
            onChange={(e) => update(row.key, 'price', e.target.value)}
            data-row={row.key}
            data-field="price"
          />
          <p className={styles.amount}>
            <span className={styles.amountLabel}>{t('qe.lineTotal')}</span>
            <span className="mono">{formatMoney(lang, amount)}</span>
          </p>
          <button
            type="button"
            className={styles.remove}
            aria-label={t(isPart ? 'qe.removePart' : 'qe.removeLabor', { n })}
            onClick={() => removeRow(row.key)}
          >
            <Trash2 size={18} aria-hidden="true" />
          </button>
        </div>
        {isPart && (
          <SelectField
            className={styles.partKind}
            label={t('sb.quote.part')}
            value={part}
            options={PART_KINDS.map((k) => ({ value: k, label: t(PART_LABEL[k]) }))}
            onChange={(e) => setPart(row.key, e.target.value as QuotePartKind)}
          />
        )}
        {isPart && part === 'both' && (
          <div className={`${styles.grid} ${styles.altGrid}`}>
            <Field
              className={styles.producer}
              label={t('qe.altProducer')}
              value={row.altBrand ?? ''}
              maxLength={QUOTE_BRAND_MAX}
              autoComplete="off"
              onChange={(e) => update(row.key, 'altBrand', e.target.value)}
              data-row={row.key}
              data-field="altBrand"
            />
            <Field
              className={styles.price}
              label={qty === null ? t('qe.altFixed') : t('qe.altUnit')}
              value={row.altPrice ?? ''}
              inputMode="decimal"
              autoComplete="off"
              mono
              error={errorAt('altPrice')}
              onChange={(e) => update(row.key, 'altPrice', e.target.value)}
              data-row={row.key}
              data-field="altPrice"
            />
            <p className={styles.amount}>
              <span className={styles.amountLabel}>{t('qe.lineTotal')}</span>
              <span className="mono">{formatMoney(lang, altBani / 100)}</span>
            </p>
          </div>
        )}
      </li>
    );
  };

  const section = (kind: QuoteLineKind) => {
    const list = rows.filter((r) => r.kind === kind);
    const sum = (kind === 'labor' ? totals.labor : totals.parts) / 100;
    const id = `qe-${kind}`;
    return (
      <section className={styles.section} aria-labelledby={id}>
        <div className={styles.sectionHead}>
          <h2 id={id}>{kind === 'labor' ? t('qe.labor') : t('qe.parts')}</h2>
          <span className="mono">{formatMoney(lang, sum)}</span>
        </div>
        <ol className={styles.lines}>{list.map((r, i) => renderRow(r, i + 1))}</ol>
        <button type="button" className={styles.add} onClick={() => addRow(kind)} disabled={rows.length >= QUOTE_ROWS_MAX}>
          <Plus size={18} aria-hidden="true" />
          {kind === 'labor' ? t('qe.addLabor') : t('qe.addPart')}
        </button>
      </section>
    );
  };

  return (
    <div ref={container} className={styles.editor}>
      <h1>{mode === 'send' ? t('qe.title.send') : t('qe.title.replace')}</h1>
      {mode === 'replace' && <p className={styles.muted}>{t('sb.quote.editBody')}</p>}

      <Card className={styles.car}>
        <p className={styles.carName}>
          {car || t('sb.card.noCar')}
          {b.car_snapshot.plate && <span className="mono"> · {b.car_snapshot.plate}</span>}
        </p>
        <p className={styles.muted}>{b.client_name || t('sb.card.deletedClient')}</p>
        <p>
          <span className={styles.label}>{t('qe.requested')}: </span>
          {services}
        </p>
        {b.note && <p className={styles.muted}>{b.note}</p>}
      </Card>

      {b.offer_percent ? <OfferNote>{offerText.promise('quote', b.offer_percent, b.offer_kind ?? null)}</OfferNote> : null}
      {b.loyalty_percent ? <OfferNote>{t('loyalty.quote', { n: b.loyalty_percent, level: b.loyalty_level ?? 1 })}</OfferNote> : null}

      {vatRate !== null && (
        <div className={styles.mode}>
          <span className={styles.label}>{t('qe.prices')}</span>
          <ChipRow label={t('qe.prices')}>
            <Chip selected={!priceMode.net} onClick={() => switchMode(false)}>
              {t('qe.prices.gross')}
            </Chip>
            <Chip selected={priceMode.net} onClick={() => switchMode(true)}>
              {t('qe.prices.net')}
            </Chip>
          </ChipRow>
        </div>
      )}

      {section('labor')}
      {section('part')}

      <div className={styles.extra}>
        <SelectField
          label={t('qe.term')}
          value={estHours}
          options={[
            { value: '', label: t('qe.term.none') },
            ...[...new Set([...DURATIONS, ...(estHours ? [Number(estHours)] : [])])]
              .sort((a, z) => a - z)
              .map((h) => ({ value: String(h), label: estimateText(lang, h) })),
          ]}
          onChange={(e) => setEstHours(e.target.value)}
        />
        <TextArea
          label={t('sb.quote.note')}
          hint={t('sb.quote.noteHint')}
          value={note}
          maxLength={NOTE_MAX}
          rows={2}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <Card className={styles.totals} aria-live="polite">
        {totals.labor > 0 && totals.parts > 0 && (
          <>
            <p>
              <span>{t('qe.totals.labor')}</span>
              <span className="mono">{formatMoney(lang, totals.labor / 100)}</span>
            </p>
            <p>
              <span>{t('qe.totals.parts')}</span>
              <span className="mono">{formatMoney(lang, totals.parts / 100)}</span>
            </p>
          </>
        )}
        {totals.net !== null && totals.vat !== null && vatRate !== null && (
          <>
            <p>
              <span>{t('qe.totals.net')}</span>
              <span className="mono">{formatMoney(lang, totals.net / 100)}</span>
            </p>
            <p>
              <span>{t('qe.totals.vat', { rate: vatRate })}</span>
              <span className="mono">{formatMoney(lang, totals.vat / 100)}</span>
            </p>
          </>
        )}
        <p className={styles.grand}>
          <span>{t('qe.totals.total')}</span>
          <span className="mono">{formatMoney(lang, totals.total / 100)}</span>
        </p>
      </Card>

      <p className={styles.muted}>
        {fee > 0 ? t('sb.quote.fee', { fee: formatMoney(lang, fee) }) : t('sb.quote.noFee')}{' '}
        {t('sb.quote.expiry', { days: plural(lang, 'unit.days', expiryDays) })}
      </p>
      {formError && (
        <p className={styles.formError} role="alert">
          {t(formError.key, formError.params)}
        </p>
      )}
      <div className={styles.buttons}>
        <ActionButton
          block={false}
          disabled={totals.total <= 0}
          onAction={submit}
          errorMessage={(e) => rpcErrorMessage(lang, e)}
          canRetry={canRetryRpc}
        >
          {mode === 'send' ? t('sb.quote.send') : t('sb.quote.sendNew')}
        </ActionButton>
        <Button variant="ghost" onClick={() => navigate(back)}>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  );
}
