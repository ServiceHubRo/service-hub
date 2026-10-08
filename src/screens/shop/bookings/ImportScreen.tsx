import { FileUp, History as HistoryIcon } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ActionButton } from '../../../components/ActionButton';
import { BackLink } from '../../../components/BackLink';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { buttonClass } from '../../../components/buttonClass';
import { Card } from '../../../components/Card';
import { LoadError } from '../../../components/LoadError';
import { SelectField } from '../../../components/SelectField';
import { canRetryRpc, rpcErrorMessage } from '../../../data/rpc';
import { addImportRows, beginImport, fetchImports, undoImport, type ShopImport } from '../../../data/shopImport';
import { useI18n } from '../../../i18n/context';
import { formatDayMonth, ymdInBucharest } from '../../../i18n/format';
import { plural } from '../../../i18n/translate';
import { ImportFileError, readTable } from '../../../lib/importFile';
import { checkRows, chunks, guessMapping, IMPORT_FIELDS, type ImportField, type ImportMapping } from '../../../lib/importRows';
import { newRequestId } from '../../../lib/requestId';
import { useLoad } from '../../../lib/useLoad';
import { columnName } from '../../../lib/xlsx';
import { SHOP_BOOKINGS_PATH, SHOP_HISTORY_PATH } from '../paths';
import { useIsShopOwner } from '../shopRole';
import styles from './import.module.css';

const MAX_BYTES = 25 * 1024 * 1024;
const SKIPPED_SHOWN = 8;
const PREVIEW_ROWS = 5;

interface Loaded {
  fileName: string;
  table: string[][];
}

/**
 * Importă clienți (T31a, `/s/programari/import`): the owner picks the file another program
 * exported (Excel or CSV), checks which column holds what, sees what comes in and what does not,
 * and imports it in chunks. Earlier imports are listed and can be undone. Nothing is sent to the
 * clients (Eduard, 5 oct).
 */
export function ImportScreen() {
  const { t, lang } = useI18n();
  const isOwner = useIsShopOwner();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [mapping, setMapping] = useState<ImportMapping>({});
  const [fileError, setFileError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<ShopImport | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // The request ids of one import, kept per tap: "Încearcă din nou" sends the same ones again, so
  // the chunks that went through are not added twice (CLAUDE.md §6.7).
  const attempts = useRef(new Map<string, { begin: string; chunks: string[] }>());
  const loadImports = useCallback(() => fetchImports(), []);
  const imports = useLoad(loadImports);

  const today = ymdInBucharest(new Date());
  const check = useMemo(() => (loaded ? checkRows(loaded.table, mapping, today) : null), [loaded, mapping, today]);

  async function pick(file: File) {
    setFileError(null);
    setResult(null);
    if (file.size > MAX_BYTES) {
      setFileError(t('imp.err.tooBig'));
      return;
    }
    setReading(true);
    try {
      const table = await readTable(file);
      attempts.current.clear();
      setLoaded({ fileName: file.name, table });
      setMapping(guessMapping(table[0] ?? []));
    } catch (e) {
      setLoaded(null);
      setFileError(t(`imp.err.${e instanceof ImportFileError ? e.code : 'unreadable'}`));
    } finally {
      setReading(false);
    }
  }

  async function runImport(requestId: string) {
    if (!loaded || !check) return;
    const parts = chunks(check.rows);
    let ids = attempts.current.get(requestId);
    if (!ids) {
      ids = { begin: requestId, chunks: parts.map(() => newRequestId()) };
      attempts.current.set(requestId, ids);
    }
    setProgress({ done: 0, total: parts.length });
    try {
      let current = await beginImport(loaded.fileName, ids.begin);
      for (const [i, part] of parts.entries()) {
        current = await addImportRows(current.id, part, ids.chunks[i]!);
        setProgress({ done: i + 1, total: parts.length });
      }
      setResult(current);
      setLoaded(null);
      setMapping({});
      imports.reload();
    } finally {
      setProgress(null);
    }
  }

  const header = loaded?.table[0] ?? [];
  const columnOptions = [
    { value: '', label: t('imp.none') },
    ...header.map((h, i) => ({ value: String(i), label: h.trim() ? `${columnName(i)} · ${h.trim()}` : columnName(i) })),
  ];

  return (
    <div className={styles.page}>
      <BackLink to={SHOP_BOOKINGS_PATH} label={t('nav.bookings')} />
      <h1>{t('imp.title')}</h1>
      <p className={styles.muted}>{t('imp.intro')}</p>

      {!isOwner ? (
        <Banner tone="info">{t('imp.ownerOnly')}</Banner>
      ) : (
        <>
          {result && (
            <Banner
              tone="info"
              action={
                <Link to={SHOP_HISTORY_PATH} className={buttonClass('secondary')}>
                  <HistoryIcon size={18} aria-hidden="true" />
                  {t('imp.toHistory')}
                </Link>
              }
            >
              {t('imp.done', {
                clients: plural(lang, 'unit.clients', result.clients),
                cars: plural(lang, 'unit.cars', result.cars),
                jobs: plural(lang, 'unit.jobs', result.jobs),
              })}
            </Banner>
          )}

          <Card className={styles.section}>
            <div className={styles.pickRow}>
              <Button variant={loaded ? 'secondary' : 'primary'} onClick={() => inputRef.current?.click()} disabled={reading}>
                <FileUp size={18} aria-hidden="true" />
                {loaded ? t('imp.pickAnother') : t('imp.pick')}
              </Button>
              {reading && <span className={styles.muted}>{t('imp.reading')}</span>}
            </div>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="visually-hidden"
              tabIndex={-1}
              aria-hidden="true"
              data-testid="import-file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void pick(file);
              }}
            />
            {fileError && <Banner tone="error">{fileError}</Banner>}
            <p className={styles.small}>{t('imp.privacy')}</p>
          </Card>

          {loaded && check && (
            <>
              <Card className={styles.section}>
                <h2 className={styles.sectionTitle}>{t('imp.columns')}</h2>
                <p className={styles.muted}>
                  {t('imp.found', { rows: plural(lang, 'unit.rows', loaded.table.length - 1), file: loaded.fileName })}
                </p>
                <div className={styles.grid}>
                  {IMPORT_FIELDS.map((field) => (
                    <SelectField
                      key={field}
                      label={t(`imp.field.${field}`)}
                      value={mapping[field] === undefined ? '' : String(mapping[field])}
                      options={columnOptions}
                      onChange={(e) => setColumn(setMapping, field, e.target.value)}
                    />
                  ))}
                </div>
              </Card>

              <Card className={styles.section}>
                <h2 className={styles.sectionTitle}>{t('imp.summary')}</h2>
                <p className={styles.counts}>
                  {t('imp.counts', {
                    clients: plural(lang, 'unit.clients', check.clients),
                    cars: plural(lang, 'unit.cars', check.cars),
                    jobs: plural(lang, 'unit.jobs', check.jobs),
                  })}
                </p>
                {check.skipped.length > 0 && (
                  <div className={styles.problems}>
                    <p>{t('imp.skipped', { rows: plural(lang, 'unit.rows', check.skipped.length) })}</p>
                    <ul>
                      {check.skipped.slice(0, SKIPPED_SHOWN).map((s) => (
                        <li key={s.row}>{t('imp.skippedRow', { row: s.row, problem: t(`imp.problem.${s.problem}`) })}</li>
                      ))}
                      {check.skipped.length > SKIPPED_SHOWN && (
                        <li>{t('imp.skippedMore', { n: check.skipped.length - SKIPPED_SHOWN })}</li>
                      )}
                    </ul>
                  </div>
                )}
                {check.ignored > 0 && (
                  <p className={styles.muted}>{t('imp.ignored', { values: plural(lang, 'unit.values', check.ignored) })}</p>
                )}
                {check.rows.length > 0 && <Preview header={header} rows={loaded.table.slice(1, 1 + PREVIEW_ROWS)} />}
                {check.rows.length === 0 && <p className={styles.warn}>{t('imp.nothing')}</p>}
                {progress && (
                  <p className={styles.muted} role="status">
                    {t('imp.progress', { done: progress.done, total: progress.total })}
                  </p>
                )}
                <ActionButton
                  onAction={runImport}
                  disabled={check.rows.length === 0}
                  errorMessage={(e) => rpcErrorMessage(lang, e)}
                  canRetry={canRetryRpc}
                >
                  {t('imp.submit')}
                </ActionButton>
              </Card>
            </>
          )}

          {imports.state.status === 'error' && <LoadError message={t('imp.loadError')} onRetry={imports.reload} />}
          {imports.state.status === 'ready' && imports.state.data.length > 0 && (
            <section className={styles.section} aria-labelledby="imports-title">
              <h2 id="imports-title" className={styles.sectionTitle}>
                {t('imp.past')}
              </h2>
              <ul className={styles.list}>
                {imports.state.data.map((imp) => (
                  <li key={imp.id}>
                    <PastImport item={imp} onUndone={imports.reload} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function setColumn(set: (fn: (m: ImportMapping) => ImportMapping) => void, field: ImportField, value: string) {
  set((m) => {
    const next: ImportMapping = { ...m };
    if (value === '') delete next[field];
    else {
      const col = Number(value);
      // A column holds one thing: taken from the field that had it.
      for (const f of IMPORT_FIELDS) if (next[f] === col) delete next[f];
      next[field] = col;
    }
    return next;
  });
}

/** The first rows as they are in the file, in a table that scrolls sideways on a phone. */
function Preview({ header, rows }: { header: readonly string[]; rows: readonly (readonly string[])[] }) {
  const { t } = useI18n();
  return (
    <div className={styles.previewWrap} role="region" aria-label={t('imp.preview')} tabIndex={0}>
      <table className={styles.preview}>
        <caption className="visually-hidden">{t('imp.preview')}</caption>
        <thead>
          <tr>
            {header.map((h, i) => (
              <th key={i} scope="col">
                {h || columnName(i)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {header.map((_, j) => (
                <td key={j}>{r[j] ?? ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** An earlier import: when, what it brought, and "Anulează importul" behind an inline confirmation. */
function PastImport({ item, onUndone }: { item: ShopImport; onUndone: () => void }) {
  const { t, lang } = useI18n();
  const [confirm, setConfirm] = useState(false);
  return (
    <Card className={styles.past}>
      <p className={styles.pastName}>{item.file_name ?? t('imp.title')}</p>
      <p className={styles.muted}>
        {t('imp.pastRow', {
          date: formatDayMonth(lang, new Date(item.created_at)),
          clients: plural(lang, 'unit.clients', item.clients),
          cars: plural(lang, 'unit.cars', item.cars),
          jobs: plural(lang, 'unit.jobs', item.jobs),
        })}
      </p>
      {item.undone_at ? (
        <p className={styles.undone}>{t('imp.undone')}</p>
      ) : confirm ? (
        <div className={styles.confirm} role="group" aria-labelledby={`undo-${item.id}`}>
          <p id={`undo-${item.id}`} className={styles.confirmTitle}>
            {t('imp.undoConfirm')}
          </p>
          <p className={styles.muted}>{t('imp.undoNote')}</p>
          <div className={styles.confirmActions}>
            <ActionButton
              variant="danger"
              onAction={async (requestId) => {
                await undoImport(item.id, requestId);
                onUndone();
              }}
              errorMessage={(e) => rpcErrorMessage(lang, e)}
              canRetry={canRetryRpc}
            >
              {t('imp.undoYes')}
            </ActionButton>
            <Button block onClick={() => setConfirm(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="ghost" onClick={() => setConfirm(true)}>
          {t('imp.undo')}
        </Button>
      )}
    </Card>
  );
}
