import { useState } from 'react';
import { Button } from '../../components/Button';
import { fetchExport, type ExportKind } from '../../data/adminTools';
import { useI18n } from '../../i18n/context';
import { ymdInBucharest } from '../../i18n/format';
import { exportFileName, exportTable } from '../../lib/adminTools';
import { toXlsx } from '../../lib/xlsx';
import { saveFile } from '../../lib/report';
import { ConfirmPanel } from './ActionPanels';

/**
 * "Descarcă CSV" (FR §5.11): the rows of one list, with the filters the list shows (bookings and
 * reviews filtered by the database, the others by `narrow`), as a file in the interface language.
 * Every export is written to the audit log (it holds personal data). A6 (M5): a reason is required,
 * at most 100 rows (the first of the list) and 5 exports an hour per admin, without phone numbers
 * or VINs — enforced by the database; the panel only says so before asking. A list filtered in the
 * browser sends the ids it shows (`ids`).
 */
export function ExportButton<R>({
  kind,
  filters = {},
  narrow,
  ids,
  label,
}: {
  kind: ExportKind;
  filters?: Record<string, unknown>;
  /** The screen's own filter, applied to the rows before writing the file. */
  narrow?: (rows: R[]) => R[];
  /**
   * The ids of the rows the screen shows after its own filters (A6): the database exports only those,
   * at most 100, so the 100-row cap applies to what the admin sees, not to the whole list.
   */
  ids?: string[];
  label?: string;
}) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const text = label ?? t('admin.export.download');
  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {text}
      </Button>
    );
  }
  return (
    <ConfirmPanel
      title={text}
      body={t('admin.export.limits')}
      textLabel={t('admin.reason')}
      textHint={t('admin.reasonHint')}
      textRequired
      confirmLabel={t('admin.export.download')}
      onConfirm={async (reason) => {
        const rows = (await fetchExport(kind, reason, ids ? { ...filters, ids: ids.slice(0, 100) } : filters)) as R[];
        const table = exportTable(kind, narrow ? narrow(rows) : rows, t, lang);
        const blob = toXlsx(table, t(`admin.export.kind.${kind}`));
        await saveFile(blob, exportFileName(kind, t, ymdInBucharest(new Date())));
        setOpen(false);
      }}
      onCancel={() => setOpen(false)}
    />
  );
}
