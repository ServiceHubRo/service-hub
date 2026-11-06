import { useI18n } from '../i18n/context';
import { SelectField } from './SelectField';
import styles from './ViewSelect.module.css';

export interface ViewItem<K extends string> {
  key: K;
  label: string;
  count?: number;
}

/**
 * Which list a screen shows (Eduard, 6 Nov 2026: a dropdown, never tabs): „Afișează: Cereri (3)”.
 * The count stays in each option, so nothing the tabs said is lost.
 */
export function ViewSelect<K extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: ViewItem<K>[];
  value: K;
  onChange: (key: K) => void;
  /** Defaults to „Afișează”. */
  label?: string;
}) {
  const { t } = useI18n();
  return (
    <SelectField
      className={styles.view}
      label={label ?? t('common.view')}
      value={value}
      onChange={(e) => onChange(e.target.value as K)}
      options={items.map((i) => ({ value: i.key, label: i.count === undefined ? i.label : `${i.label} (${i.count})` }))}
    />
  );
}
