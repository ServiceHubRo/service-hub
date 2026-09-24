import { useCallback, useEffect, useRef, useState } from 'react';
import { Checkbox } from '../../../components/Checkbox';
import { Field } from '../../../components/Field';
import { TextArea } from '../../../components/TextArea';
import { completeJob, lastOdometerForBooking, rpcErrorMessage, toRpcError, type Booking } from '../../../data/rpc';
import type { ShopBooking } from '../../../data/shopBookings';
import { useI18n } from '../../../i18n/context';
import { formatKm } from '../../../i18n/format';
import { parsePriceBani, priceText } from '../../../lib/quoteDraft';
import { useLoad } from '../../../lib/useLoad';
import { checkOdometer, type OdometerCheck } from '../../../lib/validators';
import { Panel, PanelButtons } from './BookingPanels';
import styles from './shopBookings.module.css';

const WORK_MAX = 4000;

/**
 * Finalizare (P15, P15d, FR §4.2): the odometer reading is required — km beside the field, numeric
 * keyboard, the last known reading for this plate shown under it. Lower than that is refused and
 * names it; more than 50 000 km above it needs an explicit tick. Work and cost start from the lines
 * the client approved and stay editable. The database applies the same rules (`complete_job`).
 */
export function CompletionPanel({
  booking,
  act,
  onClose,
}: {
  booking: ShopBooking;
  act: (run: () => Promise<Booking>) => Promise<void>;
  onClose: () => void;
}) {
  const { t, lang } = useI18n();
  const decimal = lang === 'ro' ? ',' : '.';
  const quote = booking.quote;
  const approved = quote ? quote.items.filter((i) => i.approved) : [];

  const loadLast = useCallback(() => lastOdometerForBooking(booking.id), [booking.id]);
  const { state: lastState, setData: setLast } = useLoad(loadLast);
  const last = lastState.status === 'ready' ? lastState.data : null;

  const [odometer, setOdometer] = useState('');
  const [work, setWork] = useState(() => approved.map((i) => i.name).join(', '));
  const [cost, setCost] = useState(() =>
    quote?.total_approved !== null && quote?.total_approved !== undefined ? priceText(quote.total_approved, decimal) : '',
  );
  const [jumpOk, setJumpOk] = useState(false);
  const [odometerError, setOdometerError] = useState<string | null>(null);
  const [costError, setCostError] = useState<string | null>(null);
  const odometerRef = useRef<HTMLInputElement>(null);
  const costRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    odometerRef.current?.focus({ preventScroll: true });
  }, []);

  const check: OdometerCheck = checkOdometer(odometer, last);
  const jump = check.ok ? check.jump : null;

  function messageOf(c: Extract<OdometerCheck, { ok: false }>): string {
    return c.error === 'odometer_lower'
      ? t('rpcError.odometer_lower', { previous: formatKm(lang, c.previous ?? 0) })
      : t(`rpcError.${c.error}`);
  }

  async function submit(requestId: string) {
    if (!check.ok) {
      setOdometerError(messageOf(check));
      odometerRef.current?.focus();
      return;
    }
    if (check.jump !== null && !jumpOk) {
      odometerRef.current?.focus();
      return;
    }
    let costValue: number | undefined;
    if (cost.trim() !== '') {
      const bani = parsePriceBani(cost);
      if (bani === null) {
        setCostError(t('sb.quote.error.price_invalid'));
        costRef.current?.focus();
        return;
      }
      costValue = bani / 100;
    }
    try {
      await act(() =>
        completeJob(
          { bookingId: booking.id, odometer: check.km, work: work.trim() || undefined, cost: costValue, confirmJump: jumpOk },
          requestId,
        ),
      );
    } catch (e) {
      // A reading recorded meanwhile (another job on the same plate): show it next to the field.
      const error = toRpcError(e);
      const previous = Number(error.params.previous);
      if ((error.code === 'odometer_lower' || error.code === 'odometer_jump') && Number.isFinite(previous)) setLast(previous);
      if (error.code === 'odometer_lower' || error.code === 'odometer_invalid' || error.code === 'odometer_required') {
        setOdometerError(rpcErrorMessage(lang, e));
        odometerRef.current?.focus();
        return;
      }
      if (error.code === 'odometer_jump') {
        setJumpOk(false);
        odometerRef.current?.focus();
        return;
      }
      throw e;
    }
  }

  const lastLine =
    lastState.status === 'loading'
      ? t('sb.complete.lastLoading')
      : lastState.status === 'error'
        ? t('sb.complete.lastError')
        : last === null
          ? t('sb.complete.first')
          : t('sb.complete.last', { km: formatKm(lang, last) });

  return (
    <Panel title={t('sb.complete.title')}>
      <div className={styles.odometer}>
        <Field
          ref={odometerRef}
          label={t('sb.complete.odometer')}
          hint={t('sb.complete.odometerHint')}
          value={odometer}
          inputMode="numeric"
          autoComplete="off"
          enterKeyHint="done"
          mono
          required
          aria-required="true"
          error={odometerError}
          end={<span className={styles.unit}>{t('unit.km')}</span>}
          onChange={(e) => {
            setOdometer(e.target.value);
            setOdometerError(null);
            setJumpOk(false);
          }}
          onBlur={() => {
            if (odometer.trim() !== '' && !check.ok) setOdometerError(messageOf(check));
          }}
        />
        {/* A "lower" error already names the last reading. */}
        {!(odometerError && !check.ok && check.error === 'odometer_lower') && <p className={styles.muted}>{lastLine}</p>}
      </div>
      {jump !== null && (
        <div className={styles.jump} role="alert">
          <p>{t('rpcError.odometer_jump', { diff: formatKm(lang, jump) })}</p>
          <Checkbox checked={jumpOk} onChange={(e) => setJumpOk(e.target.checked)}>
            {t('sb.complete.jumpConfirm')}
          </Checkbox>
        </div>
      )}
      <TextArea
        label={t('sb.complete.work')}
        hint={t('sb.complete.workHint')}
        value={work}
        maxLength={WORK_MAX}
        rows={3}
        onChange={(e) => setWork(e.target.value)}
      />
      <Field
        ref={costRef}
        label={t('sb.complete.cost')}
        hint={t('sb.complete.costHint')}
        value={cost}
        inputMode="decimal"
        autoComplete="off"
        mono
        error={costError}
        onChange={(e) => {
          setCost(e.target.value);
          setCostError(null);
        }}
      />
      <PanelButtons
        label={t('sb.complete.submit')}
        variant="success"
        disabled={!check.ok || (jump !== null && !jumpOk)}
        onAction={submit}
        onClose={onClose}
      />
    </Panel>
  );
}
