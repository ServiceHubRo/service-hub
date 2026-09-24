import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Field } from '../../../components/Field';
import { TextArea } from '../../../components/TextArea';
import { replaceQuote, sendQuote, type Booking } from '../../../data/rpc';
import type { ShopBooking } from '../../../data/shopBookings';
import { useI18n } from '../../../i18n/context';
import { formatMoney } from '../../../i18n/format';
import type { MessageKey } from '../../../i18n/ro';
import { plural } from '../../../i18n/translate';
import {
  checkDraft,
  draftTotalBani,
  priceText,
  QUOTE_NAME_MAX,
  QUOTE_ROWS_MAX,
  type QuoteDraftRow,
  type QuoteRowError,
} from '../../../lib/quoteDraft';
import { newRequestId } from '../../../lib/requestId';
import { Panel, PanelButtons } from './BookingPanels';
import styles from './shopBookings.module.css';

const NOTE_MAX = 2000;

function blankRow(): QuoteDraftRow {
  return { key: newRequestId(), name: '', price: '' };
}

const ROW_ERROR: Record<QuoteRowError, MessageKey> = {
  name_required: 'sb.quote.error.name_required',
  name_too_long: 'sb.quote.error.name_too_long',
  price_required: 'sb.quote.error.price_required',
  price_invalid: 'sb.quote.error.price_invalid',
};

/**
 * The quote composer (P15, FR §4.2): rows of item + price, "+ Adaugă poziție", an optional note and
 * the total, live. The shop's inspection fee is shown as it will be copied onto the quote. "Edit"
 * starts from the sent version and sends a new one in its place (the old one is kept for history).
 */
export function QuoteComposer({
  booking,
  mode,
  fee,
  expiryDays,
  act,
  onClose,
}: {
  booking: ShopBooking;
  mode: 'send' | 'replace';
  /** The shop's inspection fee now (copied onto the quote when sent). */
  fee: number;
  expiryDays: number;
  /** Runs the send and hands the result to the list (ShopBookingCard). */
  act: (run: () => Promise<Booking>) => Promise<void>;
  onClose: () => void;
}) {
  const { t, lang } = useI18n();
  const decimal = lang === 'ro' ? ',' : '.';
  const [rows, setRows] = useState<QuoteDraftRow[]>(() =>
    mode === 'replace' && booking.quote
      ? booking.quote.items.map((i) => ({ key: newRequestId(), name: i.name, price: priceText(i.price, decimal) }))
      : [blankRow()],
  );
  const [note, setNote] = useState(() => (mode === 'replace' ? (booking.quote?.note ?? '') : ''));
  const [errors, setErrors] = useState<Record<string, QuoteRowError>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const focusRow = useRef<{ key: string; field: 'name' | 'price' } | null>(null);

  // Focus the row just added, or the first row with an error (never the top of the page).
  useEffect(() => {
    const target = focusRow.current;
    if (!target) return;
    focusRow.current = null;
    container.current?.querySelector<HTMLInputElement>(`[data-row="${target.key}"][data-field="${target.field}"]`)?.focus();
  });

  const total = draftTotalBani(rows) / 100;

  function update(key: string, field: 'name' | 'price', value: string) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
    if (errors[key]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
    setFormError(null);
  }

  function addRow() {
    const row = blankRow();
    focusRow.current = { key: row.key, field: 'name' };
    setRows((prev) => [...prev, row]);
  }

  function removeRow(key: string) {
    setRows((prev) => {
      const index = prev.findIndex((r) => r.key === key);
      const next = prev.filter((r) => r.key !== key);
      if (next.length === 0) {
        const row = blankRow();
        focusRow.current = { key: row.key, field: 'name' };
        return [row];
      }
      const neighbour = next[Math.min(index, next.length - 1)]!;
      focusRow.current = { key: neighbour.key, field: 'name' };
      return next;
    });
  }

  async function submit(requestId: string) {
    const checked = checkDraft(rows);
    const firstBad = rows.find((r) => checked.errors[r.key]);
    if (firstBad) {
      setErrors(checked.errors);
      const error = checked.errors[firstBad.key]!;
      focusRow.current = { key: firstBad.key, field: error.startsWith('name') ? 'name' : 'price' };
      return;
    }
    if (checked.items.length === 0 || checked.items.every((i) => i.price === 0)) {
      setFormError(t('rpcError.quote_total_zero'));
      return;
    }
    const text = note.trim() || undefined;
    await act(() =>
      mode === 'send'
        ? sendQuote(booking.id, checked.items, text, requestId)
        : replaceQuote(booking.id, checked.items, text, requestId),
    );
  }

  return (
    <Panel title={mode === 'send' ? t('sb.quote.title') : t('sb.quote.editTitle')}>
      {mode === 'replace' && <p className={styles.panelBody}>{t('sb.quote.editBody')}</p>}
      <div ref={container} className={styles.composer}>
        <ol className={styles.composerRows}>
          {rows.map((row, i) => {
            const error = errors[row.key];
            const nameError = error === 'name_required' || error === 'name_too_long' ? t(ROW_ERROR[error]) : null;
            const priceError = error === 'price_required' || error === 'price_invalid' ? t(ROW_ERROR[error]) : null;
            return (
              <li key={row.key} className={styles.composerRow}>
                <Field
                  className={styles.composerName}
                  label={t('sb.quote.item', { n: i + 1 })}
                  value={row.name}
                  maxLength={QUOTE_NAME_MAX}
                  autoComplete="off"
                  error={nameError}
                  onChange={(e) => update(row.key, 'name', e.target.value)}
                  data-row={row.key}
                  data-field="name"
                />
                <Field
                  className={styles.composerPrice}
                  label={t('sb.quote.price')}
                  value={row.price}
                  inputMode="decimal"
                  autoComplete="off"
                  mono
                  error={priceError}
                  onChange={(e) => update(row.key, 'price', e.target.value)}
                  data-row={row.key}
                  data-field="price"
                />
                <button
                  type="button"
                  className={styles.removeRow}
                  aria-label={t('sb.quote.removeItem', { n: i + 1 })}
                  onClick={() => removeRow(row.key)}
                >
                  <Trash2 size={18} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ol>
        <button type="button" className={styles.addRow} onClick={addRow} disabled={rows.length >= QUOTE_ROWS_MAX}>
          <Plus size={18} aria-hidden="true" />
          {t('sb.quote.addItem')}
        </button>
        <p className={styles.quoteTotal} aria-live="polite">
          <span>{t('sb.quote.total')}</span>
          <span className="mono">{formatMoney(lang, total)}</span>
        </p>
        <TextArea
          label={t('sb.quote.note')}
          hint={t('sb.quote.noteHint')}
          value={note}
          maxLength={NOTE_MAX}
          rows={2}
          onChange={(e) => setNote(e.target.value)}
        />
        <p className={styles.muted}>
          {fee > 0 ? t('sb.quote.fee', { fee: formatMoney(lang, fee) }) : t('sb.quote.noFee')}{' '}
          {t('sb.quote.expiry', { days: plural(lang, 'unit.days', expiryDays) })}
        </p>
        {formError && (
          <p className={styles.formError} role="alert">
            {formError}
          </p>
        )}
      </div>
      <PanelButtons
        label={mode === 'send' ? t('sb.quote.send') : t('sb.quote.sendNew')}
        disabled={total <= 0}
        onAction={submit}
        onClose={onClose}
      />
    </Panel>
  );
}
