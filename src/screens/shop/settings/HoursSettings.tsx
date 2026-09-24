import { CalendarOff, CalendarPlus } from 'lucide-react';
import { useCallback, useId, useState } from 'react';
import { ActionButton } from '../../../components/ActionButton';
import { BackLink } from '../../../components/BackLink';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { Checkbox } from '../../../components/Checkbox';
import { EmptyState } from '../../../components/EmptyState';
import { Field } from '../../../components/Field';
import { SkeletonList } from '../../../components/Skeleton';
import { Stepper } from '../../../components/Stepper';
import { rpcErrorMessage } from '../../../data/rpc';
import {
  addClosure,
  deleteClosure,
  fetchClosures,
  fetchHours,
  saveHours,
  updateClosure,
  type ClosureInput,
  type DayHours,
  type ShopClosure,
} from '../../../data/shop';
import { useI18n } from '../../../i18n/context';
import { formatDate, ymdInBucharest } from '../../../i18n/format';
import type { MessageKey } from '../../../i18n/ro';
import { plural } from '../../../i18n/translate';
import { useLoad } from '../../../lib/useLoad';
import { LoadError } from '../../../components/LoadError';
import { SETTINGS_PATH } from './paths';
import { SaveButton } from './SaveButton';
import { useShopSettings } from './shopSettingsContext';
import styles from './settings.module.css';
import own from './HoursSettings.module.css';

/** Monday first, the way a Romanian workshop reads its week. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const WEEKDAYS = [1, 2, 3, 4, 5];
const STEP = 30;
const LAST = 23 * 60 + 30;

const toMinutes = (hhmm: string | null, fallback: number) => {
  if (!hhmm) return fallback;
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
const toHhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** Program și zile libere (P5b): hours per weekday, then closed periods. */
export function HoursSettings() {
  const { t } = useI18n();
  const { shop } = useShopSettings();
  const loadHours = useCallback(() => fetchHours(shop.id), [shop.id]);
  const hours = useLoad(loadHours);

  return (
    <div className={styles.page}>
      <BackLink to={SETTINGS_PATH} label={t('settings.title')} />
      <h1>{t('settings.hours')}</h1>
      <p className={styles.intro}>{t('hours.intro')}</p>

      <h2 className={styles.section}>{t('hours.week')}</h2>
      {hours.state.status === 'loading' && <SkeletonList count={3} />}
      {hours.state.status === 'error' && <LoadError message={t('settings.loadError')} onRetry={hours.reload} />}
      {hours.state.status === 'ready' && <WeekEditor initial={hours.state.data} />}

      <Closures />
    </div>
  );
}

function WeekEditor({ initial }: { initial: DayHours[] }) {
  const { t } = useI18n();
  const [week, setWeek] = useState<DayHours[]>(initial);
  const [changed, setChanged] = useState(false);

  function update(weekday: number, patch: Partial<DayHours>) {
    setWeek((w) => w.map((d) => (d.weekday === weekday ? { ...d, ...patch } : d)));
    setChanged(true);
  }

  function copyMonday() {
    const monday = week.find((d) => d.weekday === 1);
    if (!monday) return;
    setWeek((w) =>
      w.map((d) =>
        WEEKDAYS.includes(d.weekday) ? { ...d, is_closed: monday.is_closed, open_time: monday.open_time, close_time: monday.close_time } : d,
      ),
    );
    setChanged(true);
  }

  async function save(requestId: string) {
    const saved = await saveHours(week, requestId);
    setWeek(saved);
    setChanged(false);
  }

  return (
    <div className={styles.stack}>
      <Card className={own.week}>
        {WEEK_ORDER.map((weekday) => {
          const day = week.find((d) => d.weekday === weekday);
          return day ? <DayRow key={weekday} day={day} onChange={(patch) => update(weekday, patch)} /> : null;
        })}
      </Card>
      <Button block onClick={copyMonday}>
        {t('hours.copyWeekdays')}
      </Button>
      {changed && <p className={styles.warn}>{t('common.unsaved')}</p>}
      <SaveButton onSave={save}>{t('hours.save')}</SaveButton>
    </div>
  );
}

/** One weekday: "Închis", or opening and closing time in half-hour steps. */
function DayRow({ day, onChange }: { day: DayHours; onChange: (patch: Partial<DayHours>) => void }) {
  const { t } = useI18n();
  const id = useId();
  const dayName = t(`weekday.${day.weekday}` as MessageKey);
  const open = toMinutes(day.open_time, 8 * 60);
  const close = toMinutes(day.close_time, 17 * 60);
  return (
    <div className={own.day} role="group" aria-labelledby={id}>
      <div className={own.dayHead}>
        <span id={id} className={own.dayName}>
          {dayName}
        </span>
        <Checkbox
          checked={day.is_closed}
          onChange={(e) =>
            onChange(
              e.target.checked
                ? { is_closed: true }
                : { is_closed: false, open_time: toHhmm(open), close_time: toHhmm(Math.max(close, open + STEP)) },
            )
          }
        >
          <span className={day.is_closed ? own.closedOn : undefined}>{t('hours.closed')}</span>
        </Checkbox>
      </div>
      {!day.is_closed && (
        <div className={own.times}>
          <Stepper
            label={t('hours.opens')}
            value={open}
            min={0}
            max={Math.min(LAST - STEP, close - STEP)}
            step={STEP}
            format={toHhmm}
            stacked
            decreaseLabel={`${dayName} · ${t('common.decrease')}`}
            increaseLabel={`${dayName} · ${t('common.increase')}`}
            onChange={(v) => onChange({ open_time: toHhmm(v) })}
          />
          <Stepper
            label={t('hours.closes')}
            value={close}
            min={open + STEP}
            max={LAST}
            step={STEP}
            format={toHhmm}
            stacked
            decreaseLabel={`${dayName} · ${t('common.decrease')}`}
            increaseLabel={`${dayName} · ${t('common.increase')}`}
            onChange={(v) => onChange({ close_time: toHhmm(v) })}
          />
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------ closed periods

function Closures() {
  const { t } = useI18n();
  const { shop } = useShopSettings();
  const today = ymdInBucharest(new Date());
  const load = useCallback(() => fetchClosures(shop.id, today), [shop.id, today]);
  const { state, reload, setData } = useLoad(load);
  const [adding, setAdding] = useState(false);

  const sort = (list: ShopClosure[]) => [...list].sort((a, b) => a.start_date.localeCompare(b.start_date));

  return (
    <>
      <h2 className={styles.section}>{t('hours.closures')}</h2>
      <p className={styles.note}>{t('hours.closures.hint')}</p>
      {state.status === 'loading' && <SkeletonList count={3} />}
      {state.status === 'error' && <LoadError message={t('settings.loadError')} onRetry={reload} />}
      {state.status === 'ready' && (
        <div className={styles.stack}>
          {state.data.length === 0 && !adding && <EmptyState icon={CalendarOff} title={t('hours.closures.empty')} />}
          {state.data.map((c) => (
            <ClosureCard
              key={c.id}
              closure={c}
              today={today}
              onSaved={(saved) => setData((list) => sort(list.map((x) => (x.id === saved.id ? saved : x))))}
              onDeleted={() => setData((list) => list.filter((x) => x.id !== c.id))}
            />
          ))}
          {adding ? (
            <Card>
              <ClosureForm
                today={today}
                onCancel={() => setAdding(false)}
                onSubmit={async (input) => {
                  const saved = await addClosure(shop.id, input);
                  setData((list) => sort([...list, saved]));
                  setAdding(false);
                }}
              />
            </Card>
          ) : (
            <Button block onClick={() => setAdding(true)}>
              <CalendarPlus size={18} aria-hidden="true" />
              {t('hours.closures.add')}
            </Button>
          )}
        </div>
      )}
    </>
  );
}

function rangeText(lang: 'ro' | 'en', c: { start_date: string; end_date: string }) {
  return c.start_date === c.end_date ? formatDate(lang, c.start_date) : `${formatDate(lang, c.start_date)} – ${formatDate(lang, c.end_date)}`;
}

function dayCount(c: { start_date: string; end_date: string }) {
  return Math.round((Date.parse(`${c.end_date}T12:00:00Z`) - Date.parse(`${c.start_date}T12:00:00Z`)) / 86_400_000) + 1;
}

function ClosureCard({
  closure,
  today,
  onSaved,
  onDeleted,
}: {
  closure: ShopClosure;
  today: string;
  onSaved: (c: ShopClosure) => void;
  onDeleted: () => void;
}) {
  const { t, lang } = useI18n();
  const [mode, setMode] = useState<'view' | 'edit' | 'delete'>('view');
  const range = rangeText(lang, closure);

  if (mode === 'edit') {
    return (
      <Card>
        <ClosureForm
          initial={closure}
          today={today}
          onCancel={() => setMode('view')}
          onSubmit={async (input) => {
            onSaved(await updateClosure(closure.id, input));
            setMode('view');
          }}
        />
      </Card>
    );
  }

  return (
    <Card>
      <div className={styles.cardHead}>
        <div>
          <p className={styles.cardTitle}>{range}</p>
          <p className={styles.note}>
            {plural(lang, 'unit.days', dayCount(closure))}
            {closure.label ? ` · ${closure.label}` : ''}
          </p>
        </div>
      </div>
      {mode === 'view' && (
        <div className={`${styles.rowButtons} ${own.cardButtons}`}>
          <Button block onClick={() => setMode('edit')}>
            {t('common.edit')}
          </Button>
          <Button block variant="ghost" onClick={() => setMode('delete')}>
            {t('common.delete')}
          </Button>
        </div>
      )}
      {mode === 'delete' && (
        <div className={`${styles.confirm} ${own.cardButtons}`}>
          <p>{t('hours.closures.deleteConfirm', { range })}</p>
          <div className={styles.rowButtons}>
            <ActionButton
              variant="danger"
              errorMessage={(e) => rpcErrorMessage(lang, e)}
              onAction={async () => {
                await deleteClosure(closure.id);
                onDeleted();
              }}
            >
              {t('hours.closures.deleteYes')}
            </ActionButton>
            <Button block onClick={() => setMode('view')}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function ClosureForm({
  initial,
  today,
  onSubmit,
  onCancel,
}: {
  initial?: ShopClosure;
  today: string;
  onSubmit: (input: ClosureInput) => Promise<void>;
  onCancel: () => void;
}) {
  const { t, lang } = useI18n();
  const [start, setStart] = useState(initial?.start_date ?? '');
  const [end, setEnd] = useState(initial?.end_date ?? '');
  const [label, setLabel] = useState(initial?.label ?? '');
  const [error, setError] = useState<{ field: 'start' | 'end'; text: string } | null>(null);

  function validate() {
    if (!start) return { field: 'start' as const, text: t('hours.closures.error.dates') };
    if (!end) return { field: 'end' as const, text: t('hours.closures.error.dates') };
    // An ongoing period may keep its past start; a new or moved one starts today or later.
    if (start < today && start !== initial?.start_date) return { field: 'start' as const, text: t('hours.closures.error.past') };
    if (end < start) return { field: 'end' as const, text: t('hours.closures.error.order') };
    if (end < today) return { field: 'end' as const, text: t('hours.closures.error.past') };
    if (dayCount({ start_date: start, end_date: end }) > 367) return { field: 'end' as const, text: t('hours.closures.error.long') };
    return null;
  }

  return (
    <form className={styles.stack} noValidate onSubmit={(e) => e.preventDefault()}>
      <div className={styles.grid2}>
        <Field
          label={t('hours.closures.from')}
          type="date"
          min={initial && initial.start_date < today ? initial.start_date : today}
          value={start}
          onChange={(e) => {
            setStart(e.target.value);
            if (!end || end < e.target.value) setEnd(e.target.value);
            setError(null);
          }}
          error={error?.field === 'start' ? error.text : null}
        />
        <Field
          label={t('hours.closures.to')}
          type="date"
          min={start || today}
          value={end}
          onChange={(e) => {
            setEnd(e.target.value);
            setError(null);
          }}
          error={error?.field === 'end' ? error.text : null}
        />
      </div>
      <Field
        label={t('hours.closures.label')}
        placeholder={t('hours.closures.labelPlaceholder')}
        maxLength={120}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
      <div className={styles.rowButtons}>
        <ActionButton
          submit
          errorMessage={(e) => rpcErrorMessage(lang, e)}
          onAction={async () => {
            const problem = validate();
            setError(problem);
            if (problem) return;
            await onSubmit({ start_date: start, end_date: end, label: label.trim() === '' ? null : label.trim() });
          }}
        >
          {t('common.save')}
        </ActionButton>
        <Button block onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}
