import type { ProcedureVersion } from '../../data/procedures';
import type { MessageKey } from '../../i18n/ro';
import type { Lang } from '../../i18n/translate';
import { day } from '../admin/format';

type T = (key: MessageKey, params?: Record<string, string | number>) => string;

/** Who wrote, approved and published a version, as one line. */
export function versionLine(t: T, lang: Lang, v: ProcedureVersion): string {
  const parts = [v.seeded ? t('proc.history.seeded') : v.author ? t('proc.history.author', { who: v.author }) : null];
  if (v.approved_at) parts.push(t('proc.history.approved', { who: v.approved_by ?? '—', date: day(lang, v.approved_at) }));
  if (v.published_at) parts.push(t('proc.history.published', { date: day(lang, v.published_at) }));
  return parts.filter(Boolean).join(' · ');
}
