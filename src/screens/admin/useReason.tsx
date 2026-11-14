import { useState, type ReactElement } from 'react';
import { TextArea } from '../../components/TextArea';
import { useI18n } from '../../i18n/context';

/**
 * A6 (M5): the reason a sensitive admin action asks for, inside a panel that has its own form (a
 * free period, a price, a shop's data, the platform settings, an export). The database refuses the
 * action without one (`reason_required`); this only says so before sending. `take()` answers the
 * trimmed reason, or null after marking the field.
 */
export function useReason(): { field: ReactElement; take: () => string | null } {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [missing, setMissing] = useState(false);
  const field = (
    <TextArea
      label={t('admin.reason')}
      hint={t('admin.reasonHint')}
      value={text}
      maxLength={500}
      rows={2}
      error={missing ? t('admin.reasonRequired') : null}
      onChange={(e) => {
        setText(e.target.value);
        if (missing) setMissing(false);
      }}
    />
  );
  const take = () => {
    const value = text.trim();
    if (!value) {
      setMissing(true);
      return null;
    }
    return value;
  };
  return { field, take };
}
